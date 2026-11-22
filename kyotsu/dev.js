// 年度・科目ページの「偏差値を出す」。点数を入れるだけで、全国の平均点・標準偏差から偏差値を、得点分布から全国順位を出す（どこにも送らない）
(function () {
  function fmtN(x) { return Math.round(x).toLocaleString("ja-JP"); }
  document.querySelectorAll("[data-dev]").forEach(function (box) {
    var mean = +box.dataset.mean, sd = +box.dataset.sd, full = +box.dataset.full, n = +box.dataset.n || 0;
    var dist = null;
    try { dist = box.dataset.dist ? JSON.parse(box.dataset.dist) : null; } catch (e) { dist = null; }
    var input = box.querySelector("input"), out = box.querySelector(".dev-out");
    function show() {
      var v = input.value.trim();
      box.classList.remove("is-great", "is-super");
      if (v === "") { out.innerHTML = ""; return; }
      var x = Number(v);
      if (!/^\d+$/.test(v) || x > full) { out.innerHTML = '<p class="dev-err">0〜' + full + "の整数で入れてください</p>"; return; }
      var dev = 50 + 10 * (x - mean) / sd;
      var html = '<p class="dev-main"><span class="dev-k">偏差値</span><span class="dev-v">' + dev.toFixed(1) + "</span></p>";
      if (dist && n) {
        var higher = 0;
        for (var i = x + 1; i < dist.length; i++) higher += dist[i];
        var top = higher / n * 100;
        html += '<p class="dev-sub">全国 ' + fmtN(higher + 1) + "位 ／ " + fmtN(n) + "人（上位 " + (top < 0.1 ? "0.1%未満" : top.toFixed(1) + "%") + "）</p>";
      }
      html += '<p class="dev-sub">平均点 ' + mean + "点との差 " + (x - mean >= 0 ? "+" : "") + (x - mean).toFixed(1) + "点</p>";
      if (dev >= 60) {
        box.classList.add(dev >= 70 ? "is-super" : "is-great");
        html = '<p class="dev-congrats">Congratulations!</p>' + html;
      }
      out.innerHTML = html;
    }
    input.addEventListener("input", show);
    show();
  });
})();
