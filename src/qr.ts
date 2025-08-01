/* src/qr.ts – используем qr-code-generator как namespace */
/// <reference path="./qrcodegen.ts" />

import qrcodegen from "./qrcodegen";

/* ---------- DOM glue ---------- */
let token: string | null = null;

(async () => {
  // 1. OAuth token из URL
  const urlParams = new URLSearchParams(location.search);
  token = urlParams.get('token');
  if (token) {
    sessionStorage.setItem('oauth_token', token);
    history.replaceState({}, document.title, '/');
  }

  // 2. Дождаться загрузки DOM
  if (document.readyState === 'loading') {
    await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve));
  }

  // 3. Подписать внутренние ссылки токеном
  document.querySelectorAll<HTMLAnchorElement>('a[href^="/"]').forEach(a => {
    if (!a.href.includes('token=')) {
      const sep = a.href.includes('?') ? '&' : '?';
      a.href += sep + 'token=' + (token ?? '');
    }
  });

  // 4. Logout
  document.getElementById('logout')?.addEventListener('click', () => {
    sessionStorage.removeItem('oauth_token');
    location.href = '/';
  });

  // 5. Подписать поля ввода
  const inputs = document.querySelectorAll<HTMLInputElement>(
    'input[type=number], input[type=text], textarea'
  );
  inputs.forEach(el => {
    if (!el.id.startsWith('version-')) el.oninput = makeText;
  });
  (document.querySelectorAll('input[type=radio], input[type=checkbox]') as NodeListOf<HTMLInputElement>)
  .forEach(el => el.onchange = makeText);
  makeText();

  document.getElementById('loading')!.style.display = 'none';
document.getElementById('loaded')!.style.display = 'block';



})();

/* ---------- бизнес-логика ---------- */
function makeText() {
  const fio   = (document.getElementById('fio-input') as HTMLInputElement)?.value ?? '';
  const sum   = Number((document.getElementById('sum-input') as HTMLInputElement)?.value ?? 0);
  const purp  = (document.getElementById('purp-input') as HTMLInputElement)?.value ?? '';
  const org   = (document.querySelector('input[name="org"]:checked') as HTMLInputElement)?.value ?? '';

  let text = '';
  switch (org) {
    case 'org-td':
      text = `ST00012|Name=ООО «ТЕРРИТОРИЯ ДЕТСТВА»|PersonalAcc=40702810538000453171|BankName=ПАО Сбербанк|BIC=044525225|CorrespAcc=30101810400000000225|PayeeINN=7725641886|KPP=772901001|ChildFio=${fio}|Purpose=${purp}|Sum=${sum * 100}`;
      break;
    case 'org-sd':
      text = `ST00012|Name=АНО "СЧАСТЛИВОЕ ДЕТСТВО"|PersonalAcc=40703810738000017277|BankName=ПАО Сбербанк|BIC=044525225|CorrespAcc=30101810400000000225|PayeeINN=9729300383|KPP=772901001|Purpose=${purp}|Sum=${sum * 100}`;
      break;
    default:
      text = '';
  }

  (document.getElementById('text-input') as HTMLTextAreaElement).value = text;
  redrawQrCode(text, org);
}

function redrawQrCode(text: string, org: string) {
  // Используем namespace qrcodegen
  const qr = qrcodegen.QrCode.encodeText(text, qrcodegen.QrCode.Ecc.MEDIUM);

  const canvas = document.getElementById('qrcode-canvas') as HTMLCanvasElement;
  const scale = 6;
  const border = 2;
  const width = (qr.size + border * 2) * scale;
  const extraHeight = 100;

  canvas.width = width;
  canvas.height = width + extraHeight;
  const ctx = canvas.getContext('2d')!;

  // белый фон
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // рисуем QR
  ctx.fillStyle = '#000000';
  for (let y = -border; y < qr.size + border; y++) {
    for (let x = -border; x < qr.size + border; x++) {
      if (qr.getModule(x, y)) {
        ctx.fillRect((x + border) * scale, (y + border) * scale, scale, scale);
      }
    }
  }

  // текст под QR
  const lines = org === 'org-td'
    ? [
        'Реквизиты оплаты:',
        'Наименование организации: ООО «ТЕРРИТОРИЯ ДЕТСТВА»',
        'ОГРН 1087746828180, ИНН 7725641886, КПП 772901001',
        'Расчетный счет № 40702810538000453171',
        'Наименование банка: ПАО Сбербанк, БИК: 044525225',
        'Корреспондентский счет: 30101810400000000225'
      ]
    : [
        'Реквизиты оплаты:',
        'Наименование организации: АНО «СЧАСТЛИВОЕ ДЕТСТВО»',
        'ИНН: 9729300383, КПП: 772901001',
        'Номер расчетного счета: 40703810738000017277',
        'Наименование банка: ПАО Сбербанк, БИК: 044525225',
        'Корреспондентский счет: 30101810400000000225'
      ];

  ctx.font = '12px sans-serif';
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  let yPos = width + 10;
  lines.forEach(line => {
    ctx.fillText(line, 10, yPos);
    yPos += 14.4;
  });

  // ссылка «Скачать»
  const download = document.getElementById('download') as HTMLAnchorElement;
  download.download = 'qr-code.png';
  download.href = canvas.toDataURL('image/png');
}