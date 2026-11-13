/* 설치판(Windows · Android 앱) 안내.
   - 브라우저: releases 저장소가 만드는 manifest 를 읽어, 이 기기에 맞는 설치 파일이 있으면 머리글에 "앱 받기" 버튼을 띄우고
     ⚙ "앱 설치" 카드에 받을 수 있는 설치 파일을 모두 보여 준다.
   - 설치판 안: 앱이 페이지보다 먼저 넣어 두는 window.MesoApp(desktop/src-tauri/src/lib.rs)으로 버전과 "업데이트 확인"을 보여 준다.
     실제 확인 · 설치는 앱(update.rs)이 한다. */
Meso.appinfo = (function(M){
  "use strict";

  var MANIFEST = "https://yh-yeop.github.io/releases/apps/MesoCalc/manifest.json";
  var LIST = "https://github.com/yh-yeop/releases/releases?q=MesoCalc&expanded=true";
  var NAME = {windows:"Windows", android:"Android"};
  var ORDER = ["windows", "android"];
  var app = window.MesoApp || null;
  var latest = null;   // manifest (못 받았으면 null)

  function $(id){ return document.getElementById(id); }

  function device(){
    var ua = navigator.userAgent || "";
    if (/Android/i.test(ua)) return "android";
    if (/Windows/i.test(ua)) return "windows";
    return null;
  }

  // 숫자 부분만 견준다 (앱 쪽 version.rs 의 단순판 — 여기선 "새 버전 있음" 표시에만 씀)
  function newer(a, b){
    var x = String(a).split("-")[0].split("."), y = String(b).split("-")[0].split(".");
    for (var i = 0; i < Math.max(x.length, y.length); i++){
      var p = +x[i] || 0, q = +y[i] || 0;
      if (p !== q) return p > q;
    }
    return false;
  }

  function el(tag, cls, text){
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }
  function link(text, href, primary){
    var a = el("a", "btn" + (primary ? " primary" : ""), text);
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener";
    return a;
  }

  function renderHeader(){
    var btn = $("btn-app");
    if (!btn) return;
    var d = device();
    var a = !app && d && latest && latest.assets && latest.assets[d];
    btn.hidden = !a;
    if (!a) return;
    btn.href = a.url;
    btn.title = NAME[d] + " 앱 받기 (v" + latest.version + ")";
    btn.setAttribute("aria-label", btn.title);
  }

  function render(){
    var box = $("app-btns");
    if (!box) return;
    box.textContent = "";
    if (app){
      $("app-title").textContent = "앱";
      $("app-state").textContent = "v" + app.version;
      var up = latest && newer(latest.version, app.version);
      $("app-note").textContent = (NAME[app.platform] || "") + " 앱. 열 때마다 새 버전을 확인해 알려 줌." +
        (up ? " 지금 v" + latest.version + "이 나와 있음." : "");
      var b = el("button", "btn" + (up ? " primary" : ""), up ? "v" + latest.version + "으로 업데이트" : "업데이트 확인");
      b.type = "button";
      b.addEventListener("click", function(){ app.checkUpdate(); });
      box.appendChild(b);
      box.appendChild(link("모든 버전", app.releases || LIST));
      return;
    }
    var assets = latest && latest.assets || {};
    var have = ORDER.filter(function(k){ return assets[k]; });
    $("app-state").textContent = latest ? "v" + latest.version : "";
    $("app-note").textContent = have.length
      ? "브라우저 없이 창 하나로 쓰는 설치판. 새 버전이 나오면 앱이 알려 줌. 데이터는 앱에 따로 저장되니 백업이나 동기화로 옮길 것."
      : latest ? "아직 이 기기용 설치 파일이 없음." : "설치판 정보를 불러오지 못함.";
    var d = device();
    have.forEach(function(k){
      var a = assets[k];
      var size = a.size ? " · " + (a.size / 1048576).toFixed(1) + "MB" : "";
      box.appendChild(link(NAME[k] + (k === "android" ? " APK" : " 설치 파일") + size, a.url, k === d));
    });
    box.appendChild(link("모든 버전", LIST));
  }

  function load(){
    return fetch(MANIFEST, {cache: "no-cache"})
      .then(function(r){ return r.ok ? r.json() : null; })
      .catch(function(){ return null; })
      .then(function(m){
        latest = m && typeof m.version === "string" ? m : null;
        renderHeader();
        render();
      });
  }

  render();
  load();
  return {render: render, inApp: function(){ return app; }};
})(Meso);
