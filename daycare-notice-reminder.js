/*************************************************
 * 掲示・連絡事項フォーム用スクリプト
 * 送信 + 催促 + 回答通知
 *************************************************/


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
    noticeFormUrl: getRequiredScriptProperty('NOTICE_FORM_URL'),
  };
}

function validateSettings() {
  getSecrets();
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
  return `notice_answered_${formatDateKey(date)}`;
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
 * グループ送信
 *************************************************/
function sendNoticeForm() {
  validateSettings();
  if (!isWeekday()) return;

  if (isDailyRunDone('notice_form_skipped')) {
    console.log('今日は掲示フォームを送らない設定のためスキップ');
    return;
  }

  if (isDailyRunDone('notice_form_sent')) {
    console.log('掲示フォームは本日送信済みのためスキップ');
    return;
  }

  const secrets = getSecrets();

  const text =
    '園に入る前に確認してください。\n' +
    '・掲示板を確認\n' +
    '・先生からの連絡がないか確認\n\n' +
    '掲示・連絡事項の入力はこちら:\n' +
    secrets.noticeFormUrl;

  pushLineText(secrets.lineToId, text);
  markDailyRunDone('notice_form_sent');

  pushLineText(secrets.myLineToId, '掲示・連絡事項フォームをグループに送信しました。');
}


/*************************************************
 * 催促
 *************************************************/

function remindNoticeFormIfNeeded() {
  validateSettings();
  if (!isWeekday()) return;

  if (!isDailyRunDone('notice_form_sent')) {
    console.log('掲示フォーム未送信のため催促スキップ');
    return;
  }

  if (isAnsweredToday()) {
    console.log('掲示フォーム回答済みのため催促スキップ');
    return;
  }

  pushLineText(
    getSecrets().lineToId,
    '掲示・連絡事項の入力がまだ未回答です。\n' +
    '入力をお願いします。\n\n' +
    getSecrets().noticeFormUrl
  );
}


/*************************************************
 * 回答通知
 * 掲示系フォーム送信時トリガーで実行
 *************************************************/

function onFormSubmit(e) {
  validateSettings();
  if (!isWeekday()) return;

  const response = e.response;
  markAnswered(response.getTimestamp());

  const summary = buildResponseSummary(response);

  pushLineText(
    getSecrets().myLineToId,
    '掲示フォームの本日の回答です。\n\n' + summary
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
      key.includes('_answered_')
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

function skipNoticeFormToday() {
  validateSettings();

  markDailyRunDone('notice_form_skipped');

  pushLineText(
    getSecrets().myLineToId,
    '今日は掲示・連絡事項フォームを送らない設定にしました。'
  );
}
