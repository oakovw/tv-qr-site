/* src/cf.ts – 1-to-1 TS rewrite */
const { S3 } = require('@aws-sdk/client-s3');

const ALLOWED_USERS = [
  'laramartish@yandex.ru',
  'oa.kovylin@yandex.ru'
];

const s3 = new S3({
  region: 'ru-central1',
  endpoint: 'https://storage.yandexcloud.net',
  credentials: {
    accessKeyId:     process.env.ACCESS_KEY_ID!,
    secretAccessKey: process.env.SECRET_ACCESS_KEY!
  }
});

function getMimeType(filename: string) {
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

function isUserAllowed(email: string) {
  return ALLOWED_USERS.includes(email);
}

async function getUserInfo(oauthToken: string) {
  const res = await fetch('https://login.yandex.ru/info', {
    headers: { Authorization: `OAuth ${oauthToken}` }
  });
  if (!res.ok) throw new Error('Bad token');
  return await res.json() as { default_email: string };
}

async function handleOAuthCallback(event: any) {
  const code = event.queryStringParameters?.code;
  if (!code) return { statusCode: 400, body: JSON.stringify({ message: 'Authorization code required' }) };

  const tokenResp = await fetch('https://oauth.yandex.ru/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=authorization_code&code=${code}&client_id=${process.env.YANDEX_CLIENT_ID}&client_secret=${process.env.YANDEX_CLIENT_SECRET}`
  });
  const tokenData = await tokenResp.json();
  if (!tokenData.access_token) return { statusCode: 401, body: JSON.stringify({ message: 'Failed to get access token' }) };

  const user = await getUserInfo(tokenData.access_token);
  if (!isUserAllowed(user.default_email)) return { statusCode: 403, body: JSON.stringify({ message: 'Access denied', email: user.default_email }) };

  const redirectUrl = `${process.env.SITE_URL}?token=${tokenData.access_token}`;
  return { statusCode: 302, headers: { Location: redirectUrl } };
}

async function handleSiteRequest(event: any) {
  let key = event.pathParameters?.file || 'index.html';
  if (key === '/' || key.endsWith('/')) key += 'index.html';

  // Public file
  if (key === 'qr.js') {
    const mime = getMimeType(key);
    try {
      const obj = await s3.getObject({ Bucket: process.env.BUCKET_NAME!, Key: key });
      const data = await obj.Body!.transformToByteArray();
      return {
        statusCode: 200,
        headers: { 'Content-Type': mime, 'Cache-Control': 'public, max-age=3600' },
        body: Buffer.from(data).toString(mime.startsWith('text') ? 'utf8' : 'base64'),
        isBase64Encoded: !mime.startsWith('text')
      };
    } catch (e: any) {
      return e.name === 'NoSuchKey'
        ? { statusCode: 404, body: 'Not found' }
        : { statusCode: 500, body: 'S3 error' };
    }
  }

  // Auth check
  const token = (event.headers?.Authorization?.replace('Bearer ', '') || event.queryStringParameters?.token);
  if (!token) return authRedirect();

  const user = await getUserInfo(token);
  if (!isUserAllowed(user.default_email)) return { statusCode: 403, body: 'Access denied' };

  // Serve other files
  const mime = getMimeType(key);
  try {
    const obj = await s3.getObject({ Bucket: process.env.BUCKET_NAME!, Key: key });
    const data = await obj.Body!.transformToByteArray();
    return {
      statusCode: 200,
      headers: { 'Content-Type': mime, 'Cache-Control': 'public, max-age=3600' },
      body: Buffer.from(data).toString(mime.startsWith('text') ? 'utf8' : 'base64'),
      isBase64Encoded: !mime.startsWith('text')
    };
  } catch (e: any) {
    return e.name === 'NoSuchKey'
      ? { statusCode: 404, body: 'Not found' }
      : { statusCode: 500, body: 'S3 error' };
  }
}

function authRedirect() {
  const url = `https://oauth.yandex.ru/authorize?response_type=code&client_id=${process.env.YANDEX_CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.CALLBACK_URL!)}`;
  return { statusCode: 401, headers: { 'Content-Type': 'text/html' }, body: `<html><body><a href="${url}">Login with Yandex</a></body></html>` };
}

// Handler
exports.handler = async (event: any, _context: any) => {
  console.log('Event:', JSON.stringify(event));

  if (event.path === '/oauth/callback') return await handleOAuthCallback(event);
  return await handleSiteRequest(event);
};