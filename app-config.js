// 回答の送信先（Apps Script のウェブアプリ URL）。Code.gs を「新バージョン」で更新しても URL は変わらない。
window.SURVEY_API_URL = "https://script.google.com/macros/s/AKfycbzweAZmpLGl2PB5OcjPVMm3oakEWJh2av8DbAeorch-Sr1iaYU9E_GSY6SR0z0EjDlx/exec";

// API 呼び出しの共通処理（フォーム・集計ページで共用）
window.surveyApi = {
  get(action) {
    const url = window.SURVEY_API_URL;
    return fetch(url + (url.includes("?") ? "&" : "?") + "action=" + action).then(r => r.json());
  },
  post(body) {
    // text/plain で送ると CORS のプリフライトが発生せず Apps Script でも受け取れる
    return fetch(window.SURVEY_API_URL, {
      method: "POST",
      headers: {"Content-Type": "text/plain;charset=utf-8"},
      body: JSON.stringify(body),
    }).then(r => r.json());
  },
};

// ホームページに iframe で埋め込んだとき、親ページへ高さを知らせる（README の埋め込みコード用）
(function () {
  if (window.parent === window || typeof ResizeObserver === "undefined") return;
  const send = () => window.parent.postMessage(
    {type: "hoshitobu-survey-height", height: document.documentElement.scrollHeight}, "*");
  window.addEventListener("load", () => new ResizeObserver(send).observe(document.body));
})();
