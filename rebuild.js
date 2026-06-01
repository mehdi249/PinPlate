#!/usr/bin/env node
// Rebuilds index.html by injecting the latest app.compiled.js between the
// onerror handler and the ReactDOM bootstrap footer. Also stamps BUILD_TIME
// and wires up an auto-update banner so the phone reloads when a new
// version is deployed.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname);
const htmlPath = path.join(root, 'index.html');
const jsPath   = path.join(root, 'app.compiled.js');

const html = fs.readFileSync(htmlPath, 'utf8');
const js   = fs.readFileSync(jsPath,   'utf8');

const lines = html.split('\n');
const onerrorIdx = lines.findIndex(l => l.includes('window.onerror'));
if (onerrorIdx === -1) { console.error('Could not find window.onerror line'); process.exit(1); }

const header = lines.slice(0, onerrorIdx + 1).join('\n');

const buildTime = Math.floor(Date.now() / 1000);

// Auto-update checker: runs on focus + visibility change + every 60 s.
// Fetches index.html with cache:'no-store', compares BUILD_TIME, shows a
// tap-to-reload banner if a newer version is found.
const autoUpdate = `
const BUILD_TIME = ${buildTime};
(function(){
  var checking=false;
  async function checkUpdate(){
    if(checking)return; checking=true;
    try{
      var r=await fetch(location.pathname+'?v='+Date.now(),{cache:'no-store'});
      var html=await r.text();
      var m=html.match(/BUILD_TIME\\s*=\\s*(\\d+)/);
      if(m&&parseInt(m[1])>BUILD_TIME){
        if(document.getElementById('_upd'))return;
        var b=document.createElement('div');
        b.id='_upd';
        b.onclick=function(){location.reload(true);};
        b.style.cssText='position:fixed;bottom:0;left:0;right:0;z-index:9999;background:#2c1f14;color:#fdf8f3;text-align:center;padding:18px 16px 28px;font-family:Georgia,serif;font-size:15px;cursor:pointer;letter-spacing:-0.01em;';
        b.textContent='New version available — tap to refresh';
        document.body.appendChild(b);
      }
    }catch(e){}
    checking=false;
  }
  document.addEventListener('visibilitychange',function(){if(!document.hidden)checkUpdate();});
  window.addEventListener('focus',checkUpdate);
  setInterval(checkUpdate,60000);
})();`;

const swReg = `
if('serviceWorker'in navigator){
  navigator.serviceWorker.register('/PinPlate/sw.js',{scope:'/PinPlate/'})
    .then(reg=>{
      reg.addEventListener('updatefound',()=>{
        var nw=reg.installing;
        nw.addEventListener('statechange',()=>{
          if(nw.state==='installed'&&navigator.serviceWorker.controller){
            location.reload();
          }
        });
      });
    });
  // When the SW tells us a new version activated, reload immediately
  navigator.serviceWorker.addEventListener('controllerchange',()=>location.reload());
}`;

const footer = `\n${autoUpdate}\n${swReg}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App, null));

</script>
</body>
</html>`;

const newHtml = header + '\n' + js + footer;
fs.writeFileSync(htmlPath, newHtml);
console.log(`Rebuilt index.html — BUILD_TIME=${buildTime} — size=${newHtml.length}`);
