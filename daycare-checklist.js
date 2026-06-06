/*************************************************
 * 保育園チェックリスト用スクリプト
 * LINE承認送信 + LINE入力でチェックリスト更新 + 回答通知
 *************************************************/

const CONFIG = {
  itemCheckboxTitle: '今日の持ち物',

  baseItems: [
    'スタイ1枚（身に着けていればOK）',
    'ビニール袋',
  ],

  weekdayExtraItems: {
    1: [
      'スリーパー（ロッカー左上の全員共通のスリーパー用箱に入れておく）',
      'カラー帽子（ロッカー左上の全員共通の帽子用箱に入れておく）'
    ]
  },

  dateExtraItems: {
    // '2026-04-14': ['帽子']
  }
};


/*************************************************
 * Script Property
 *************************************************/

function getRequiredScriptProperty(key) {
  if (!key) {
    throw new Error('getRequiredScriptProperty に key が渡されていません。');
  }

  const value = PropertiesService.getScriptProperties().getProperty(key);

  if (!value) {
    throw new Error(`スクリプトプロパティ「${key}」が未設定です。`);
  }

  return value;
}

function getSecrets() {
  return {
    lineChannelAccessToken: getRequiredScriptProperty('LINE_CHANNEL_ACCESS_TOKEN'),
    lineToId: getRequiredScriptProperty('LINE_TO_ID'),
    myLineToId: getRequiredScriptProperty('MY_LINE_TO_ID'),
    itemFormId: getRequiredScriptProperty('ITEM_FORM_ID'),
    itemFormUrl: getRequiredScriptProperty('ITEM_FORM_URL'),
  };
}

function validateSettings() {
  getSecrets();

  if (!CONFIG.itemCheckboxTitle) {
    throw new Error('CONFIG.itemCheckboxTitle が未設定です。');
  }
}


/*************************************************
 * Utils
 *************************************************/

function formatDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDateTime(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${y}/${m}/${d} ${hh}:${mm}`;
}

function isWeekday(date = new Date()) {
  const day = date.getDay();
  return day >= 1 && day <= 5;
}

function parsePostbackData(data) {
  const result = {};

  data.split('&').forEach(pair => {
    const [key, value] = pair.split('=');
    result[decodeURIComponent(key)] = decodeURIComponent(value || '');
  });

  return result;
}

function parseBulletItems(text) {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .map(line => line.replace(/^[-・*＊●○\d]+[.)、．]?\s*/, ''))
    .filter(line => line.length > 0);
}


/*************************************************
 * LINE送信
 *************************************************/

function pushLineText(to, text) {
  const secrets = getSecrets();
  const url = 'https://api.line.me/v2/bot/message/push';

  const payload = {
    to: to,
    messages: [
      {
        type: 'text',
        text: text,
      },
    ],
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + secrets.lineChannelAccessToken,
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  const response = UrlFetchApp.fetch(url, options);
  const body = response.getContentText();
  const statusCode = response.getResponseCode();

  console.log(`LINE response status=${statusCode} body=${body}`);

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`LINE送信失敗 status=${statusCode} body=${body}`);
  }
}

function pushLineConfirmToMe(text, yesData, noData) {
  const secrets = getSecrets();
  const url = 'https://api.line.me/v2/bot/message/push';

  const payload = {
    to: secrets.myLineToId,
    messages: [
      {
        type: 'text',
        text: text,
        quickReply: {
          items: [
            {
              type: 'action',
              action: {
                type: 'postback',
                label: '送る',
                data: yesData,
                displayText: '送る'
              }
            },
            {
              type: 'action',
              action: {
                type: 'postback',
                label: '送らない',
                data: noData,
                displayText: '送らない'
              }
            }
          ]
        }
      }
    ]
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + secrets.lineChannelAccessToken,
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  const response = UrlFetchApp.fetch(url, options);
  const body = response.getContentText();
  const statusCode = response.getResponseCode();

  console.log(`LINE confirm response status=${statusCode} body=${body}`);

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`LINE確認メッセージ送信失敗 status=${statusCode} body=${body}`);
  }
}


/*************************************************
 * Form取得・更新
 *************************************************/

function openItemForm() {
  return FormApp.openById(getSecrets().itemFormId);
}

function getItemCheckboxItem() {
  const form = openItemForm();

  const checkboxItem = form.getItems(FormApp.ItemType.CHECKBOX)
    .map(item => item.asCheckboxItem())
    .find(item => item.getTitle() === CONFIG.itemCheckboxTitle);

  if (!checkboxItem) {
    const titles = form.getItems(FormApp.ItemType.CHECKBOX)
      .map(item => item.asCheckboxItem().getTitle());

    throw new Error(
      `持ち物フォームに「${CONFIG.itemCheckboxTitle}」というチェックボックス質問が見つかりません。` +
      ` 見つかったチェックボックス: ${JSON.stringify(titles)}`
    );
  }

  return checkboxItem;
}

function updateItemFormChoicesByItems(items) {
  if (!items || items.length === 0) {
    throw new Error('持ち物が1つもありません。');
  }

  const uniqueItems = [...new Set(items)];
  const checkboxItem = getItemCheckboxItem();
  const choices = uniqueItems.map(item => checkboxItem.createChoice(item));

  checkboxItem.setChoices(choices);

  console.log('持ち物フォーム更新完了: ' + JSON.stringify(uniqueItems));
}


/*************************************************
 * 日次フラグ
 *************************************************/

function buildDailyRunKey(prefix, date = new Date()) {
  return `${prefix}_${formatDateKey(date)}`;
}

function markDailyRunDone(prefix, date = new Date()) {
  PropertiesService.getScriptProperties()
    .setProperty(buildDailyRunKey(prefix, date), 'done');
}

function isDailyRunDone(prefix, date = new Date()) {
  return PropertiesService.getScriptProperties()
    .getProperty(buildDailyRunKey(prefix, date)) === 'done';
}

function buildAnsweredKey(date = new Date()) {
  return `item_answered_${formatDateKey(date)}`;
}

function markAnswered(date = new Date()) {
  PropertiesService.getScriptProperties()
    .setProperty(buildAnsweredKey(date), 'done');
}

function isAnsweredToday(date = new Date()) {
  return PropertiesService.getScriptProperties()
    .getProperty(buildAnsweredKey(date)) === 'done';
}


/*************************************************
 * LINE入力待ち状態
 *************************************************/

function buildInputModeKey(date = new Date()) {
  return `input_mode_${formatDateKey(date)}`;
}

function setInputMode(mode, date = new Date()) {
  PropertiesService.getScriptProperties()
    .setProperty(buildInputModeKey(date), mode);
}

function getInputMode(date = new Date()) {
  return PropertiesService.getScriptProperties()
    .getProperty(buildInputModeKey(date));
}

function clearInputMode(date = new Date()) {
  PropertiesService.getScriptProperties()
    .deleteProperty(buildInputModeKey(date));
}


/*************************************************
 * 個人への送信確認
 *************************************************/

function askMeToSendItemForm() {
  validateSettings();
  if (!isWeekday()) return;

  if (isDailyRunDone('item_form_sent')) {
    console.log('持ち物フォームは本日送信済みのため確認不要');
    return;
  }

  const todayKey = formatDateKey(new Date());

  pushLineConfirmToMe(
    '今日の持ち物チェックリストをLINEグループに送りますか？',
    `action=prepare_item_form&date=${todayKey}`,
    `action=skip_item_form&date=${todayKey}`
  );
}

function askMeToInputItemList() {
  setInputMode('waiting_item_list');

  pushLineText(
    getSecrets().myLineToId,
    'チェックリストに追加する持ち物を箇条書きで送ってください。\n\n' +
    '※基本の持ち物は自動で含まれます。\n\n' +
    '例:\n' +
    '・カラー帽子\n' +
    '・スリーパー'
  );
}


/*************************************************
 * チェックリスト更新・グループ送信
 *************************************************/

function handleItemListMessage(text) {
  const inputItems = parseBulletItems(text);

  const items = [...new Set([
    ...CONFIG.baseItems,
    ...inputItems
  ])];

  if (items.length === 0) {
    pushLineText(
      getSecrets().myLineToId,
      '持ち物が読み取れませんでした。箇条書きで送ってください。'
    );
    return;
  }

  updateItemFormChoicesByItems(items);
  clearInputMode();

  pushLineText(
    getSecrets().myLineToId,
    'チェックリストに反映しました。\n\n' +
    items.map(item => `・${item}`).join('\n')
  );

  sendItemForm();

  if (isDailyRunDone('item_form_sent')) {
    pushLineText(
      getSecrets().myLineToId,
      '持ち物チェックリストをLINEグループに送信しました。'
    );
  }
}

function sendItemForm() {
  if (!isWeekday()) return;

  if (isDailyRunDone('item_form_sent')) {
    console.log('持ち物フォームは本日送信済みのためスキップ');
    return;
  }

  const secrets = getSecrets();

  const text =
    '今日の持ち物チェックをお願いします。\n\n' +
    '回答はこちら:\n' +
    secrets.itemFormUrl;

  pushLineText(secrets.lineToId, text);
  markDailyRunDone('item_form_sent');
}


/*************************************************
 * LINE Webhook受信
 * ※同じLINE公式アカウントで使う場合、Webhook URLはこのスクリプトに設定
 *************************************************/

function doPost(e) {
  const lock = LockService.getScriptLock();

  try {
    lock.tryLock(3000);

    const secrets = getSecrets();
    const body = JSON.parse(e.postData.contents);
    const events = body.events || [];

    events.forEach(event => {
      if (!event.source || event.source.userId !== secrets.myLineToId) {
        console.log('自分以外からのイベントのため無視');
        return;
      }

      if (event.type === 'message' && event.message && event.message.type === 'text') {
        const mode = getInputMode();

        if (mode === 'waiting_item_list') {
          handleItemListMessage(event.message.text);
          return;
        }

        console.log('入力待ち状態ではないためテキストメッセージを無視');
        return;
      }

      if (event.type !== 'postback') return;

      const data = parsePostbackData(event.postback.data);
      const action = data.action;
      const date = data.date;
      const todayKey = formatDateKey(new Date());

      if (date !== todayKey) {
        pushLineText(secrets.myLineToId, '古い確認ボタンなので処理しませんでした。');
        return;
      }

      if (action === 'prepare_item_form') {
        askMeToInputItemList();
        return;
      }

      if (action === 'skip_item_form') {
        clearInputMode();
        markDailyRunDone('item_form_skipped');
        pushLineText(secrets.myLineToId, '今日は持ち物チェックリストを送らない設定にしました。skipNoticeFormTodayを手動実行してください');
        return;
      }
    });

    return ContentService.createTextOutput('OK');

  } catch (error) {
    console.error(error);

    try {
      pushLineText(getSecrets().myLineToId, 'Webhook処理でエラーが出ました: ' + error.message);
    } catch (_) {}

    return ContentService.createTextOutput('OK');
  } finally {
    lock.releaseLock();
  }
}


/*************************************************
 * 催促
 *************************************************/

function remindItemFormIfNeeded() {
  validateSettings();
  if (!isWeekday()) return;

  if (!isDailyRunDone('item_form_sent')) {
    console.log('持ち物フォーム未送信のため催促スキップ');
    return;
  }

  if (isAnsweredToday()) {
    console.log('持ち物フォーム回答済みのため催促スキップ');
    return;
  }

  pushLineText(
    getSecrets().lineToId,
    '今日の持ち物チェックがまだ未回答です。\n' +
    '入力をお願いします。\n\n' +
    getSecrets().itemFormUrl
  );
}


/*************************************************
 * 回答通知
 * チェックリストフォーム送信時トリガーで実行
 *************************************************/

function onFormSubmit(e) {
  validateSettings();
  if (!isWeekday()) return;

  const response = e.response;
  markAnswered(response.getTimestamp());

  const summary = buildResponseSummary(response);

  pushLineText(
    getSecrets().myLineToId,
    '持ち物フォームの本日の回答です。\n\n' + summary
  );
}

function buildResponseSummary(response) {
  if (!response) {
    return '今日の回答はまだありません。';
  }

  const ts = response.getTimestamp();
  const itemResponses = response.getItemResponses();

  let text = `回答時刻: ${formatDateTime(ts)}\n\n`;

  itemResponses.forEach(itemResponse => {
    const title = itemResponse.getItem().getTitle();
    const answer = itemResponse.getResponse();

    let answerText = '';

    if (Array.isArray(answer)) {
      answerText = answer.join(', ');
    } else if (answer === null || answer === undefined || answer === '') {
      answerText = '(未入力)';
    } else {
      answerText = String(answer);
    }

    text += `${title}: ${answerText}\n`;
  });

  return text;
}


function clearDailyFlagsOnly() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();

  Object.keys(all).forEach(key => {
    if (
      key.includes('_sent_') ||
      key.includes('_skipped_') ||
      key.includes('_answered_') ||
      key.startsWith('input_mode_')
    ) {
      props.deleteProperty(key);
    }
  });

  console.log('日次フラグのみ削除しました。');
}

/*************************************************
 * 古い日次フラグ掃除
 *************************************************/
function cleanupOldFlags() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();

  // 何日前まで残すか
  const keepDays = 7;

  const now = new Date();

  let deletedCount = 0;

  Object.keys(all).forEach(key => {

    // 削除対象だけに限定
    const isTarget =
      key.includes('_sent_') ||
      key.includes('_skipped_') ||
      key.includes('_answered_') ||
      key.startsWith('input_mode_');

    if (!isTarget) {
      return;
    }

    // キーから YYYY-MM-DD を抽出
    const match = key.match(/\d{4}-\d{2}-\d{2}/);

    if (!match) {
      return;
    }

    const dateText = match[0];

    // 日付化
    const targetDate = new Date(dateText + 'T00:00:00');

    // 日数差
    const diffDays = Math.floor(
      (now.getTime() - targetDate.getTime()) /
      (1000 * 60 * 60 * 24)
    );

    // 古いものだけ削除
    if (diffDays > keepDays) {
      props.deleteProperty(key);
      deletedCount++;

      console.log(`削除: ${key}`);
    }
  });

  console.log(`cleanupOldFlags 完了: ${deletedCount}件削除`);
}
