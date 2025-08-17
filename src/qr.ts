import qrcodegen from "./qrcodegen";

/* ---------- DOM glue ---------- */
let token: string | null = null;

// --- ИСПРАВЛЕННАЯ ЛОГИКА ФОРМАТИРОВАНИЯ ---
// Функция для форматирования числа с запятой и двумя знаками после
// Предназначена для работы со значением из <input type="text">
// Корректно обрабатывает промежуточные состояния вроде "1234," или "123,4"
function formatCurrencyInput(value: string): string {
  // 1. Разрешаем только цифры, запятую и пробелы
  let cleaned = value.replace(/[^\d,\s]/g, '');
  // 2. Убираем все пробелы для внутренней обработки
  let workingValue = cleaned.replace(/\s/g, '');

  // 3. Находим позицию первой запятой
  const commaIndex = workingValue.indexOf(',');

  let integerPart = '';
  let decimalPart = '';

  if (commaIndex === -1) {
    // 3a. Запятой нет - вся строка это целая часть
    integerPart = workingValue.substring(0, 12); // Ограничиваем 12 символами
  } else {
    // 3b. Запятая есть
    // Целая часть - до запятой
    integerPart = workingValue.substring(0, commaIndex).substring(0, 12);
    // Дробная часть - после запятой
    decimalPart = workingValue.substring(commaIndex + 1, commaIndex + 3); // Максимум 2 знака
    // Убираем из дробной части любые оставшиеся запятые (на случай вставки "1,2,3")
    decimalPart = decimalPart.replace(/,/g, '');
  }

  // 4. Если целая часть пустая, делаем её "0" (но только если это конечное значение)
  // Это нужно, чтобы "0" отображался, но при этом можно было начать ввод с запятой (",1" -> "0,1")
  // Однако, если пользователь просто ввел ",", мы не хотим сразу превращать это в "0".
  // Лучше проверить, была ли введена запятая в конце.
  // Более простой и надежный способ: если integerPart пустая И decimalPart не пустая, ставим "0".
  // Но если и integerPart пустая и decimalPart пустая, оставляем пустой, чтобы пользователь мог ввести цифру.
  // Однако, если workingValue это просто ",", то integerPart="" и decimalPart="", и мы получим "".
  // Нужно разрешить существование висячей запятой.
  // Проверим, заканчивается ли исходная строка (после очистки) на запятую.
  const endsWithComma = workingValue.endsWith(',');

  // Если целая часть пустая и дробная тоже пустая, но строка заканчивается на запятую
  if (integerPart === '' && decimalPart === '' && endsWithComma) {
    // Разрешаем "0," для удобства или просто ","
    // Проще всего: если integerPart пустой, ставим "0"
    integerPart = '0';
    // decimalPart остается пустым, но запятая будет добавлена ниже
    // Нет, это неверно. Мы должны вернуть "0,".
    // Пересмотрим логику формирования финальной строки.
  }
  // Если целая часть пустая, но дробная есть, или просто висячая запятая
  if (integerPart === '' && (decimalPart !== '' || endsWithComma)) {
    integerPart = '0';
  }
  // Если и целая и дробная пустые, возвращаем пустую строку
  if (integerPart === '' && decimalPart === '') {
    return '';
  }

  // 5. Добавляем пробелы как разделители разрядов к целой части
  integerPart = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  // 6. Собираем финальную строку
  // Если decimalPart не пустая, добавляем запятую
  // Или если исходная строка заканчивалась на запятую, и decimalPart пустая
  if (decimalPart !== '') {
    return `${integerPart},${decimalPart}`;
  } else if (endsWithComma) {
    // Если decimalPart пустая, но строка заканчивается на запятую, добавляем запятую
    return `${integerPart},`;
  } else {
    // Если нет дробной части и нет висячей запятой
    return integerPart;
  }
}
// --- КОНЕЦ ИСПРАВЛЕННОЙ ЛОГИКИ ---

// Обработчик ввода для поля суммы
function handleSumInput(e: Event) {
  const input = e.target as HTMLInputElement;
  const oldValue = input.value;
  const selectionStart = input.selectionStart ?? oldValue.length;

  // Получаем отформатированное значение
  const formattedValue = formatCurrencyInput(input.value);

  // Если значение изменилось, обновляем поле
  if (input.value !== formattedValue) {
    input.value = formattedValue;
    // Пытаемся восстановить позицию курсора (приблизительно)
    // Это упрощенная логика
    const lengthDiff = formattedValue.length - oldValue.length;
    let newCursorPos = selectionStart + lengthDiff;
    newCursorPos = Math.max(0, Math.min(newCursorPos, formattedValue.length));
    input.setSelectionRange(newCursorPos, newCursorPos);
  }

  // Вызываем основную бизнес-логику
  makeText();
}

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
  document.getElementById('logout')?.addEventListener('click', (e) => {
    e.preventDefault();
    sessionStorage.removeItem('oauth_token');
    window.location.href = '/';
  });
  // 5. Подписать поля ввода
  const inputs = document.querySelectorAll<HTMLInputElement>(
    'input[type=text], textarea' // <-- Исправлен селектор
  );
  inputs.forEach(el => {
    if (el.id === 'sum-input') {
      // Для поля суммы используем специальный обработчик
      el.addEventListener('input', handleSumInput);
      // Также вешаем onchange
      el.addEventListener('change', handleSumInput);
    } else if (!el.id.startsWith('version-')) {
      // Остальные поля работают как раньше
      el.oninput = makeText;
    }
  });
  (document.querySelectorAll('input[type=radio], input[type=checkbox]') as NodeListOf<HTMLInputElement>)
    .forEach(el => el.onchange = makeText);

  // Инициализируем отображение
  makeText();
  document.getElementById('loading')!.style.display = 'none';
  document.getElementById('loaded')!.style.display = 'block';
})();

/* ---------- бизнес-логика ---------- */
function makeText() {
  const fio = (document.getElementById('fio-input') as HTMLInputElement)?.value ?? '';
  // Получаем значение суммы из поля ввода
  const sumInput = document.getElementById('sum-input') as HTMLInputElement;
  let sumValue = 0;
  if (sumInput) {
    // Получаем "сырое" числовое значение из отформатированной строки
    let rawValueStr = sumInput.value.replace(/\s/g, ''); // Убираем пробелы
    rawValueStr = rawValueStr.replace(',', '.'); // Заменяем запятую на точку для parseFloat
    const rawValueNum = parseFloat(rawValueStr);
    if (!isNaN(rawValueNum) && isFinite(rawValueNum) && rawValueNum >= 0) {
      sumValue = rawValueNum;
    }
  }
  const purp = (document.getElementById('purp-input') as HTMLInputElement)?.value ?? '';
  const org = (document.querySelector('input[name="org"]:checked') as HTMLInputElement)?.value ?? '';
  let text = '';
  switch (org) {
    case 'org-td':
      text = `ST00012|Name=ООО «ТЕРРИТОРИЯ ДЕТСТВА»|PersonalAcc=40702810538000453171|BankName=ПАО Сбербанк|BIC=044525225|CorrespAcc=30101810400000000225|PayeeINN=7725641886|KPP=772901001|ChildFio=${fio}|Purpose=${purp}|Sum=${Math.round(sumValue * 100)}`;
      break;
    case 'org-sd':
      text = `ST00012|Name=АНО "СЧАСТЛИВОЕ ДЕТСТВО"|PersonalAcc=40703810738000017277|BankName=ПАО Сбербанк|BIC=044525225|CorrespAcc=30101810400000000225|PayeeINN=9729300383|KPP=772901001|ChildFio=${fio}|Purpose=${purp}|Sum=${Math.round(sumValue * 100)}`;
      break;
    default:
      text = '';
  }
  (document.getElementById('text-input') as HTMLTextAreaElement).value = text;
  redrawQrCode(text, org);
}

function redrawQrCode(text: string, org: string) {
  // Используем namespace qrcodegen
  try {
    const qr = qrcodegen.QrCode.encodeText(text, qrcodegen.QrCode.Ecc.MEDIUM);
    const canvas = document.getElementById('qrcode-canvas') as HTMLCanvasElement;
    const scale = 6;
    const border = 2;
    const width = (qr.size + border * 2) * scale;
    const extraHeight = 100;
    canvas.width = width;
    canvas.height = width + extraHeight + width / 9;
    const ctx = canvas.getContext('2d')!;
    // белый фон
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // рисуем QR
    ctx.fillStyle = '#000000';
    for (let y = -border; y < qr.size + border; y++) {
      for (let x = -border; x < qr.size + border; x++) {
        if (qr.getModule(x, y)) {
          ctx.fillRect((x + border) * scale, width / 9 + 10 + 100 + (y + border) * scale, scale, scale);
        }
      }
    }

    const img = document.getElementById("logo") as CanvasImageSource;
    ctx.drawImage(img, 10, 10, width / 3, width / 9);

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
    let yPos = width + 10 + width / 9;
    lines.forEach(line => {
      ctx.fillText(line, 10, yPos);
      yPos += 15; // 14.4;
    });

    ctx.font = 'bold 16px Arial';
    ctx.fillText('QR-код для оплаты', width / 3 + 40, width / 18);

    ctx.font = '14px Arial';
    ctx.fillText('Ученик:', 10, width / 9 + 30);
    ctx.fillText('Назначение платежа:', 10, width / 9 + 50);

    // ссылка «Скачать»
    const download = document.getElementById('download') as HTMLAnchorElement;
    download.download = 'qr-code.jpeg';
    download.href = canvas.toDataURL('image/jpeg', 1.0);
  } catch (err) {
    console.error("QR Code generation error:", err);
    // alert("Ошибка генерации QR-кода. Проверьте введенные данные.");
  }
}