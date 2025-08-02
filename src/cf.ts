/* src/index.ts – verbatim JS → TS */
const { S3 } = require('@aws-sdk/client-s3');

const ALLOWED_USERS = [
  'laramartish@yandex.ru',
  'oa.kovylin@yandex.ru'
];

const s3 = new S3({
  region: 'ru-central1',
  endpoint: 'https://storage.yandexcloud.net',
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
  }
});

function getMimeType(filename: string): string {
  const mimeTypes: Record<string, string> = {
    '.html': 'text/html',
    '.css':  'text/css',
    '.js':   'application/javascript',
    '.json': 'application/json',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif':  'image/gif',
    '.svg':  'image/svg+xml',
    '.ico':  'image/x-icon'
  };
  const ext = '.' + filename.split('.').pop()!.toLowerCase();
  return mimeTypes[ext] || 'application/octet-stream';
}

function isUserAllowed(email: string): boolean {
  return ALLOWED_USERS.includes(email);
}

async function getUserInfo(oauthToken: string): Promise<{ default_email: string }> {
  const response = await fetch('https://login.yandex.ru/info', {
    headers: { Authorization: `OAuth ${oauthToken}` }
  });
  if (!response.ok) throw new Error('Failed to get user info');
  return response.json();
}

async function handleOAuthCallback(event: any) {
  const code = event.queryStringParameters?.code;
  if (!code) {
    return { statusCode: 400, body: JSON.stringify({ message: 'Authorization code required' }) };
  }
  
  // Добавляем redirect_uri
  const redirectUri = process.env.CALLBACK_URL; 
  if (!redirectUri) {
     console.error("CALLBACK_URL environment variable is not set!");
     return { statusCode: 500, body: JSON.stringify({ message: 'Server configuration error' }) };
  }

  // Формируем тело запроса с redirect_uri
  const body = `grant_type=authorization_code&code=${code}&client_id=${process.env.YANDEX_CLIENT_ID}&client_secret=${process.env.YANDEX_CLIENT_SECRET}&redirect_uri=${encodeURIComponent(redirectUri)}`;

  const tokenResponse = await fetch('https://oauth.yandex.ru/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body // Используем body с redirect_uri
  });
  
  const tokenData = await tokenResponse.json();
  if (!tokenData.access_token) {
    console.error("Yandex token endpoint error response:", JSON.stringify(tokenData)); // Логируем ответ для диагностики
    return { statusCode: 401, body: JSON.stringify({ message: 'Failed to get access token from Yandex', details: tokenData /* Можно убрать позже */ }) };
  }

  const userInfo = await getUserInfo(tokenData.access_token);

  if (!isUserAllowed(userInfo.default_email)) {
    return {
      statusCode: 403,
      body: JSON.stringify({ message: 'Access denied', email: userInfo.default_email })
    };
  }

  const redirectUrl = `${process.env.SITE_URL}?token=${tokenData.access_token}`;
  return { statusCode: 302, headers: { Location: redirectUrl } };
}

async function handleSiteRequest(event: any) {
  // 1. Определяем запрашиваемый файл (исправляем логику)
  let key: string;
  if (event.path === '/' || event.path === '') {
    key = 'index.html';
  } else {
    // Убираем начальный слэш
    key = event.path.startsWith('/') ? event.path.substring(1) : event.path;
  }

  // 2. Новая логика: ВСЕ файлы публичны, кроме index.html
  // ИЛИ, чтобы быть совсем точным: только index.html требует авторизации
  const isPublic = (key !== 'index.html');

  if (isPublic) {
    // 3. Отдача публичного файла БЕЗ проверки авторизации
    const mime = getMimeType(key);
    try {
      const response = await s3.getObject({ Bucket: process.env.BUCKET_NAME!, Key: key });
      const chunks: Buffer[] = [];
      for await (const chunk of response.Body!) chunks.push(chunk);
      const bodyBuffer = Buffer.concat(chunks);
      return {
        statusCode: 200,
        headers: { 'Content-Type': mime, 'Cache-Control': 'public, max-age=3600' },
        body: bodyBuffer.toString(mime.startsWith('text') ? 'utf8' : 'base64'),
        isBase64Encoded: !mime.startsWith('text')
      };
    } catch (e: any) {
      console.error("Ошибка получения публичного файла из S3:", e);
      return e.name === 'NoSuchKey'
        ? { statusCode: 404, body: JSON.stringify({ message: 'Public file not found' }) }
        : { statusCode: 500, body: JSON.stringify({ message: 'S3 error' }) };
    }
  }

  // 4. Если файл НЕ публичный (т.е. это index.html), проверяем авторизацию
  const authHeader = event.headers?.Authorization;
  let oauthToken: string | null = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    oauthToken = authHeader.substring(7);
  } else if (event.queryStringParameters?.token) {
    oauthToken = event.queryStringParameters.token;
  }

  if (!oauthToken) {
    return authRedirect();
  }

  let userInfo;
  try {
    userInfo = await getUserInfo(oauthToken);
  } catch (error) {
    console.error("Ошибка получения информации о пользователе:", error);
    // Редиректим на OAuth, если токен невалиден
    return authRedirect();
  }

  if (!isUserAllowed(userInfo.default_email)) {
    return {
      statusCode: 403,
      body: JSON.stringify({ message: 'Access denied' }),
    };
  }

  // 5. Если авторизация успешна, отдаем index.html
  const mime = getMimeType(key); // key === 'index.html'
  try {
    const response = await s3.getObject({ Bucket: process.env.BUCKET_NAME!, Key: key });
    const chunks: Buffer[] = [];
    for await (const chunk of response.Body!) chunks.push(chunk);
    const bodyBuffer = Buffer.concat(chunks);
    return {
      statusCode: 200,
      headers: { 'Content-Type': mime, 'Cache-Control': 'no-cache' }, // no-cache для index.html
      body: bodyBuffer.toString(mime.startsWith('text') ? 'utf8' : 'base64'),
      isBase64Encoded: !mime.startsWith('text')
    };
  } catch (e: any) {
    console.error("Ошибка получения index.html из S3:", e);
    return e.name === 'NoSuchKey'
      ? { statusCode: 404, body: JSON.stringify({ message: 'index.html not found' }) }
      : { statusCode: 500, body: JSON.stringify({ message: 'Internal server error', error: e.message }) };
  }
}

function authRedirect() {
  const url = `https://oauth.yandex.ru/authorize?response_type=code&client_id=${process.env.YANDEX_CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.CALLBACK_URL!)}`;
  return {
    statusCode: 401,
    headers: { 'Content-Type': 'text/html' },
    body: `<html><body><a href="${url}">Login with Yandex</a></body></html>`
  };
}

// Handler entrypoint               , context: any
exports.handler = async (event: any) => {
  console.log('Event:', JSON.stringify(event));
  if (event.path === '/oauth/callback') return await handleOAuthCallback(event);
  return await handleSiteRequest(event);
};