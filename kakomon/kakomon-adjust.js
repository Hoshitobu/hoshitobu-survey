// 得点調整のあった試験（大学入試センターの公表による）。平均点・標準偏差・分布は調整後、大問ごとの平均・設問の正答率は調整前の素点。
// 素点で入れた点数から出す偏差値・順位は、低めに出る「目安」になる。
// 該当：2021 第1日程（公民：現代社会・政治・経済／理科②：物理・化学）、2023 本試験（理科②：化学・生物）。
//   上記以外（2021 第2日程、2022、2024、2025、2026、各追試験）は得点調整なし。
// 出典（大学入試センター）
//   令和3年度 実施結果等（得点調整について・公民換算表・理科②換算表）https://www.dnc.ac.jp/kyotsu/kako_shiken_jouhou/r3/
//     換算表PDF：https://www.dnc.ac.jp/albums/abm.php?d=72&f=abm00001237.pdf（公民）／ …abm00001236.pdf（理科②）。
//     公民は現代社会・政治・経済の列、理科②は物理・化学の列だけ素点と換算後の点が異なる（倫理・生物は同じ）。倫理，政治・経済と地学は対象外。
//   令和4年度 https://www.dnc.ac.jp/kyotsu/kako_shiken_jouhou/r4/（「得点調整について」PDF：得点調整は行わない）
//   令和5年度 https://www.dnc.ac.jp/kyotsu/kako_shiken_jouhou/r5/ 理科②換算表PDF https://www.dnc.ac.jp/albums/abm.php?d=494&f=abm00003359.pdf
//     素点と換算後の点が異なるのは化学・生物の列だけ（物理は同じ）。地学は受験者1万人未満で対象外。
//   令和6・7・8年度 https://www.dnc.ac.jp/kyotsu/kako_shiken_jouhou/r6/ ・ r7/ ・ r8/（得点調整は行わない）
// text は、その試験のページ・表に出す注記（各項目ごと。2021は大問・設問のデータがないので別の文）。
// 各項目の bookId / bookName / subjectId / subjectName は点数集計（Code.gs の CONFIG）の本・科目に合わせる。表示側（score-grid.js・results.html）はこの4つで突き合わせる。
window.KAKOMON_ADJUST = {
  "2021-honshi-gensha": {bookId: "day1_2021", bookName: "2021第1日程", subjectId: "gensha", subjectName: "現代社会", note: "得点調整あり（公民）", text: "平均点と標準偏差は得点調整後です。偏差値は目安です。"},
  "2021-honshi-seikei": {bookId: "day1_2021", bookName: "2021第1日程", subjectId: "seikei", subjectName: "政治・経済", note: "得点調整あり（公民）", text: "平均点と標準偏差は得点調整後です。偏差値は目安です。"},
  "2021-honshi-phys": {bookId: "day1_2021", bookName: "2021第1日程", subjectId: "phys", subjectName: "物理", note: "得点調整あり（理科②）", text: "平均点と標準偏差は得点調整後です。偏差値は目安です。"},
  "2021-honshi-chem": {bookId: "day1_2021", bookName: "2021第1日程", subjectId: "chem", subjectName: "化学", note: "得点調整あり（理科②）", text: "平均点と標準偏差は得点調整後です。偏差値は目安です。"},
  "2023-honshi-chem": {bookId: "honshi2023", bookName: "2023本試", subjectId: "chem", subjectName: "化学", note: "得点調整あり（理科②）", text: "平均点と分布は得点調整後、大問・設問の平均は調整前の点です。偏差値・順位は目安です。"},
  "2023-honshi-bio": {bookId: "honshi2023", bookName: "2023本試", subjectId: "bio", subjectName: "生物", note: "得点調整あり（理科②）", text: "平均点と分布は得点調整後、大問・設問の平均は調整前の点です。偏差値・順位は目安です。"}
};
