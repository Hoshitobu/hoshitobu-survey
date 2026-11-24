// 対戦（早押し）の Firebase 設定。本人が Firebase の設定の値を貼る所。
// 値が空のときは、対戦の画面は作り物のゴースト＋CPU で動く（Firebase にはつながない）。
//
// 貼り方: Firebase コンソール →「プロジェクトの設定」→「全般」→「マイアプリ」の firebaseConfig の中身を、下の5つに写す。
//   これはサイトに書きこむ前提の値で、知られても問題ない（守りは database.rules.json の規則が受け持つ）。
//   手順は _横断/サイト_対戦/本人がすること.md と Firebase_作り方.md を見る。
// 2026-11-24 本人が作ったプロジェクト hoshitobu-battle の値を入れた。
window.HOSHITOBU_FIREBASE = {
  apiKey: "AIzaSyDRidXZuyNhLkUk9fkrOLENaHomVc8R4S0",
  authDomain: "hoshitobu-battle.firebaseapp.com",
  databaseURL: "https://hoshitobu-battle-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "hoshitobu-battle",
  appId: "1:78978768523:web:dddc160b325604af4dfe8e"
};
