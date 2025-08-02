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

  const tokenResponse = await fetch('https://oauth.yandex.ru/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=authorization_code&code=${code}&client_id=${process.env.YANDEX_CLIENT_ID}&client_secret=${process.env.YANDEX_CLIENT_SECRET}`
  });
  const tokenData = await tokenResponse.json();

  if (!tokenData.access_token) {
    return { statusCode: 401, body: JSON.stringify({ message: 'Failed to get access token' }) };
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
  let key = event.pathParameters?.file || 'index.html';
  if (key === '/' || key.endsWith('/')) key += 'index.html';

  // Public file
  const isPublic = key.startsWith('assets/') || key === 'index.html';
  // if (key === 'qr.js') {
  if (isPublic) {
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
      return e.name === 'NoSuchKey'
        ? { statusCode: 404, body: JSON.stringify({ message: 'Public file not found' }) }
        : { statusCode: 500, body: JSON.stringify({ message: 'S3 error' }) };
    }
  }

  // Auth check
  const authHeader = event.headers?.Authorization;
  let oauthToken: string | null = null;
  if (authHeader && authHeader.startsWith('Bearer ')) oauthToken = authHeader.substring(7);
  else if (event.queryStringParameters?.token) oauthToken = event.queryStringParameters.token;

  if (!oauthToken) return authRedirect();

  const userInfo = await getUserInfo(oauthToken);
  if (!isUserAllowed(userInfo.default_email)) {
    return { statusCode: 403, body: JSON.stringify({ message: 'Access denied' }) };
  }

  // Serve file
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
    return e.name === 'NoSuchKey'
      ? { statusCode: 404, body: JSON.stringify({ message: 'File not found' }) }
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