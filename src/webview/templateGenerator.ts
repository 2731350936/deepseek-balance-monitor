import { Webview, Uri } from 'vscode';
import * as crypto from 'crypto';

export function generateDashboardHtml(
  webview: Webview, extensionUri: Uri, apiKeyConfigured: boolean
): string {
  const nonce = crypto.randomBytes(16).toString('base64');
  const echartsUri = webview.asWebviewUri(Uri.joinPath(extensionUri, 'media', 'echarts.min.js'));

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none';
                 script-src 'nonce-${nonce}' ${webview.cspSource};
                 style-src 'unsafe-inline' ${webview.cspSource};
                 font-src ${webview.cspSource};
                 img-src 'none';">
  <title>DeepSeek</title>
  <style>
    :root{
      --bg:var(--vscode-editor-background, #0d0d14);
      --surface:rgba(255,255,255,.04);
      --surface-hover:rgba(255,255,255,.07);
      --border:rgba(255,255,255,.08);
      --border-strong:rgba(255,255,255,.14);
      --text:var(--vscode-editor-foreground, #e4e4e8);
      --text-secondary:rgba(255,255,255,.62);
      --text-tertiary:rgba(255,255,255,.48);
      --accent:#818cf8;
      --accent-dim:rgba(129,140,248,.15);
      --green:#6ee7b7;
      --green-dim:rgba(110,231,183,.12);
      --orange:#f59e5c;
      --orange-dim:rgba(245,158,92,.12);
      --red:#f87171;
      --font:'Inter', 'SF Pro Text', 'SF Pro Display', var(--vscode-font-family, 'Microsoft YaHei'), -apple-system, sans-serif;
      --radius-lg:20px;
      --radius-md:14px;
      --radius-sm:8px;
    }
    *{margin:0;padding:0;box-sizing:border-box}
    body{
      background:var(--bg,#0d0d14);
      color:var(--text);font-family:var(--font);
      font-size:14px;padding:36px 32px;line-height:1.55;font-weight:500;
      -webkit-font-smoothing:antialiased;
    }

    .header{
      display:flex;align-items:center;justify-content:space-between;
      margin-bottom:40px;
    }
    .header-left{display:flex;align-items:center;gap:18px}
    .header h1{font-size:28px;font-weight:550;letter-spacing:-.5px;color:var(--text)}
    .header .status{
      display:flex;align-items:center;gap:6px;font-size:13px;font-weight:500;color:var(--text-secondary)
    }
    .status-dot{width:7px;height:7px;border-radius:50%}
    .status-dot.ok{background:var(--green);box-shadow:0 0 6px var(--green)}
    .status-dot.error{background:var(--red);box-shadow:0 0 6px var(--red)}

    .section-title{
      font-size:13px;font-weight:700;text-transform:uppercase;
      letter-spacing:1.2px;color:var(--text-tertiary);
      margin-bottom:18px;margin-top:36px;
    }

    /* cards */
    .cards{display:grid;gap:14px;margin-bottom:10px}
    .cards.col4{grid-template-columns:repeat(4,1fr)}
    .cards.col3{grid-template-columns:repeat(3,1fr)}
    .cards.col2{grid-template-columns:repeat(2,1fr)}
    @media(max-width:720px){.cards.col4,.cards.col3{grid-template-columns:repeat(2,1fr)}}
    @media(max-width:400px){.cards{grid-template-columns:1fr}}

    .card{
      background:var(--surface);
      border:1px solid var(--border);
      border-radius:var(--radius-lg);
      padding:24px 28px;
      transition:background .25s,border-color .25s,transform .25s;
      backdrop-filter:blur(20px);
      -webkit-backdrop-filter:blur(20px);
    }
    .card:hover{
      background:var(--surface-hover);
      border-color:var(--border-strong);
      transform:translateY(-1px);
    }
    .card-label{
      font-size:13px;font-weight:600;letter-spacing:.4px;
      color:var(--text-secondary);margin-bottom:8px;
    }
    .card-value{
      font-size:38px;font-weight:550;letter-spacing:-.8px;
      color:var(--text);line-height:1.1;
    }
    .card-value.sm{font-size:24px;font-weight:550}
    .card-sub{
      font-size:12px;font-weight:500;color:var(--text-tertiary);margin-top:10px;
      display:flex;align-items:center;gap:8px;
    }
    .card-value.accent{color:var(--accent)}
    .card-value.orange{color:var(--orange)}
    .card-value.green{color:var(--green)}
    .card-value.red{color:var(--red)}

    /* cache bar */
    .cache-bar-wrap{margin-top:10px}
    .cache-bar-label{font-size:10px;color:var(--text-tertiary);margin-bottom:4px}
    .cache-bar{height:3px;border-radius:2px;background:rgba(255,255,255,.06);overflow:hidden}
    .cache-bar-fill{height:100%;border-radius:2px;transition:width .6s ease;background:var(--green)}

    /* period switch */
    .period-switch{
      display:inline-flex;gap:2px;margin-bottom:18px;
      background:var(--surface);border:1px solid var(--border);
      border-radius:var(--radius-sm);padding:3px;
    }
    .period-btn{
      padding:6px 20px;cursor:pointer;font-size:13px;font-weight:600;
      border-radius:7px;color:var(--text-secondary);
      background:none;border:none;font-family:var(--font);
      transition:all .2s;letter-spacing:.3px;
    }
    .period-btn:hover{color:var(--text)}
    .period-btn.active{background:rgba(255,255,255,.08);color:var(--text)}

    /* chart */
    .chart-container{
      width:100%;height:240px;
      background:var(--surface);border:1px solid var(--border);
      border-radius:var(--radius-lg);padding:16px;margin-bottom:8px;
    }
    .chart-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:8px}
    @media(max-width:800px){.chart-row{grid-template-columns:1fr}}
    .chart-row .chart-container{height:220px}

    /* heatmap */
    .heatmap-wrap{
      background:var(--surface);border:1px solid var(--border);
      border-radius:var(--radius-lg);padding:20px 22px;margin-bottom:8px;
    }
    .heatmap-header{display:flex;margin-left:30px;margin-bottom:6px;gap:0}
    .heatmap-header .mth{font-size:10px;color:var(--text-tertiary);font-weight:600;letter-spacing:.3px}
    .heatmap-body{display:flex}
    .heatmap-weekdays{display:flex;flex-direction:column;gap:3px;margin-right:6px;padding-top:2px}
    .heatmap-weekdays .wd{width:12px;height:12px;font-size:10px;font-weight:600;line-height:12px;text-align:center;color:var(--text-tertiary)}
    .heatmap-grid{display:flex;flex-direction:column;gap:3px;flex:1;overflow:hidden}
    .heatmap-row{display:flex;gap:3px}
    .heatmap-cell{
      width:12px;height:12px;border-radius:3px;cursor:default;transition:transform .15s;position:relative
    }
    .heatmap-cell:hover{transform:scale(1.4);z-index:1}
    .heatmap-cell.lv0{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.05)}
    .heatmap-cell.lv1{background:var(--accent-dim)}
    .heatmap-cell.lv2{background:rgba(129,140,248,.3)}
    .heatmap-cell.lv3{background:rgba(129,140,248,.55)}
    .heatmap-cell.lv4{background:rgba(129,140,248,.82)}
    .heatmap-tt{
      display:none;position:fixed;z-index:999;pointer-events:none;
      background:rgba(20,20,35,.96);color:var(--text);
      border:1px solid rgba(129,140,248,.3);border-radius:var(--radius-sm);
      padding:6px 12px;font-size:11px;font-weight:500;letter-spacing:.2px;
      backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);
      box-shadow:0 4px 24px rgba(0,0,0,.5);
    }
    .heatmap-legend{display:flex;align-items:center;justify-content:flex-end;gap:4px;margin-top:12px}
    .hc{width:10px;height:10px;border-radius:2px;display:inline-block}
    .hc.lv0{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06)}
    .hc.lv1{background:var(--accent-dim)}
    .hc.lv2{background:rgba(129,140,248,.3)}
    .hc.lv3{background:rgba(129,140,248,.55)}
    .hc.lv4{background:rgba(129,140,248,.82)}

    /* meta */
    .meta{
      display:flex;align-items:center;justify-content:space-between;
      font-size:13px;font-weight:500;color:var(--text-tertiary);
      padding:16px 0;margin-top:12px;
    }
    .refresh-btn{
      background:var(--surface);color:var(--text);
      border:1px solid var(--border);border-radius:var(--radius-sm);
      padding:7px 18px;cursor:pointer;font-size:13px;font-family:var(--font);
      font-weight:600;letter-spacing:.3px;transition:all .2s;
    }
    .refresh-btn:hover{background:var(--surface-hover);border-color:var(--border-strong)}

    /* settings */
    .settings-section{
      background:var(--surface);border:1px solid var(--border);
      border-radius:var(--radius-lg);padding:20px 22px;margin-top:16px;
    }
    .settings-section h3{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:var(--text-tertiary);margin-bottom:14px}
    .key-status{display:flex;align-items:center;gap:8px;margin-bottom:10px;font-size:13px;font-weight:500;color:var(--text-secondary)}
    .key-status .dot{width:7px;height:7px;border-radius:50%}
    .key-status .dot.set{background:var(--green);box-shadow:0 0 6px var(--green)}
    .key-status .dot.unset{background:var(--text-tertiary)}
    .btn-row{display:flex;gap:10px}
    .btn{
      background:var(--surface);color:var(--text-secondary);
      border:1px solid var(--border);border-radius:var(--radius-sm);
      padding:7px 16px;cursor:pointer;font-size:12px;font-family:var(--font);
      font-weight:600;letter-spacing:.3px;transition:all .2s;
    }
    .btn:hover{background:var(--surface-hover);color:var(--text);border-color:var(--border-strong)}
    .btn.accent{background:var(--accent-dim);color:var(--accent);border-color:rgba(129,140,248,.2)}
    .btn.accent:hover{background:rgba(129,140,248,.25)}
    .btn.danger{background:transparent;color:var(--red);border-color:rgba(248,113,113,.2)}
    .btn.danger:hover{background:rgba(248,113,113,.1)}

    .error-banner{
      background:rgba(248,113,113,.08);color:var(--red);
      border:1px solid rgba(248,113,113,.15);border-radius:var(--radius-md);
      padding:12px 18px;margin-bottom:20px;font-size:12px;display:none;
    }
    .error-banner.visible{display:block}

    .divider{height:1px;background:var(--border);margin:4px 0 12px}
  </style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <h1>DeepSeek</h1>
      <div class="status">
        <span class="status-dot ok" id="status-dot"></span>
        <span id="status-text">运行中</span>
      </div>
    </div>
  </div>
  <div class="error-banner" id="error-banner"></div>

  <!-- 余额 -->
  <div class="section-title">账户余额</div>
  <div class="cards col4">
    <div class="card">
      <div class="card-label">总余额</div>
      <div class="card-value" id="card-total">--</div>
      <div class="card-sub"><span id="card-available"></span></div>
    </div>
    <div class="card">
      <div class="card-label">本月消费</div>
      <div class="card-value orange" id="card-total-cost">--</div>
      <div class="card-sub">当月累计</div>
    </div>
    <div class="card">
      <div class="card-label">总消费</div>
      <div class="card-value red" id="card-alltime-cost">--</div>
      <div class="card-sub">历史累计</div>
    </div>
    <div class="card">
      <div class="card-label">Token 估算</div>
      <div class="card-value accent" id="card-token-est">--</div>
      <div class="card-sub">基于消耗率</div>
    </div>
  </div>

  <!-- 模型明细 -->
  <div class="section-title">模型明细 · 今日</div>
  <div class="cards col2" id="model-cards">
    <div class="card"><div class="card-label">加载中...</div><div class="card-value sm">--</div></div>
  </div>

  <!-- 用量统计 -->
  <div class="section-title">用量统计</div>
  <div class="period-switch">
    <button class="period-btn active" data-period="today">今日</button>
    <button class="period-btn" data-period="month">本月</button>
  </div>

  <div class="cards col4" id="usage-today">
    <div class="card">
      <div class="card-label">消耗 Token</div>
      <div class="card-value" id="ut-tokens">--</div>
      <div class="card-sub">输入 <span id="ut-in">--</span> · 输出 <span id="ut-out">--</span></div>
    </div>
    <div class="card">
      <div class="card-label">今日消费</div>
      <div class="card-value orange" id="ut-cost-display">--</div>
      <div class="card-sub" id="ut-cost-sub"></div>
    </div>
    <div class="card">
      <div class="card-label">缓存命中率</div>
      <div class="card-value green" id="ut-cache">--</div>
      <div class="card-sub" id="ut-cache-detail"></div>
      <div class="cache-bar-wrap" id="ut-cache-bar-wrap" style="display:none">
        <div class="cache-bar"><div class="cache-bar-fill" id="ut-cache-bar" style="width:0%"></div></div>
      </div>
    </div>
    <div class="card">
      <div class="card-label">API 请求次数</div>
      <div class="card-value" id="ut-requests">--</div>
      <div class="card-sub" id="ut-requests-rate"></div>
    </div>
  </div>

  <div class="cards col4" id="usage-month" style="display:none">
    <div class="card">
      <div class="card-label">消耗 Token</div>
      <div class="card-value" id="um-tokens">--</div>
      <div class="card-sub">输入 <span id="um-in">--</span> · 输出 <span id="um-out">--</span></div>
    </div>
    <div class="card">
      <div class="card-label">本月消费</div>
      <div class="card-value orange" id="um-cost-display">--</div>
      <div class="card-sub" id="um-cost-sub"></div>
    </div>
    <div class="card">
      <div class="card-label">缓存命中率</div>
      <div class="card-value green" id="um-cache">--</div>
      <div class="card-sub" id="um-cache-detail"></div>
      <div class="cache-bar-wrap" id="um-cache-bar-wrap" style="display:none">
        <div class="cache-bar"><div class="cache-bar-fill" id="um-cache-bar" style="width:0%"></div></div>
      </div>
    </div>
    <div class="card">
      <div class="card-label">API 请求次数</div>
      <div class="card-value" id="um-requests">--</div>
      <div class="card-sub" id="um-requests-total"></div>
    </div>
  </div>

  <!-- 图表 -->
  <div class="section-title">每日 Token 消耗</div>
  <div class="heatmap-wrap">
    <div class="heatmap-header" id="heatmap-months"></div>
    <div class="heatmap-body">
      <div class="heatmap-weekdays"></div>
      <div class="heatmap-grid" id="heatmap-grid"></div>
    </div>
    <div class="heatmap-tt" id="heatmap-tt"></div>
    <div class="heatmap-legend">
      <span class="hc lv0"></span><span class="hc lv1"></span><span class="hc lv2"></span><span class="hc lv3"></span><span class="hc lv4"></span>
    </div>
  </div>

  <div class="chart-row">
    <div>
      <div class="section-title" style="margin-top:0">余额趋势</div>
      <div class="chart-container" id="chart-balance"></div>
    </div>
    <div>
      <!-- empty for balance -->
    </div>
  </div>

  <!-- 底部 -->
  <div class="meta">
    <span>更新于 <strong id="last-refresh">--</strong></span>
    <button class="refresh-btn" id="btn-refresh">刷新</button>
  </div>

  <div class="settings-section">
    <h3>平台连接</h3>
    <div class="key-status" style="margin-bottom:10px">
      <span class="dot set" id="cookie-dot"></span>
      <span id="cookie-status-text">--</span>
      <span id="cookie-age" style="font-size:11px;color:var(--text-tertiary);margin-left:8px"></span>
    </div>

    <!-- ★ 推荐方式 -->
    <div style="background:var(--accent-dim);border:1px solid rgba(129,140,248,.2);border-radius:var(--radius-md);padding:14px 18px;margin-bottom:12px">
      <div style="font-size:13px;font-weight:700;color:var(--accent);margin-bottom:6px">★ 推荐 · Playwright 自动同步</div>
      <div style="font-size:12px;color:var(--text-secondary);margin-bottom:10px">
        可读取全部 Cookie（含 HttpOnly），浏览器 Profile 持久化，几周才需重新登录一次。<br>
        前置要求（一次性）：<code style="color:var(--accent)">npm install -g playwright && npx playwright install chromium</code>
      </div>
      <button class="btn accent" id="btn-sync-playwright">🔐 Playwright 自动登录</button>
    </div>

    <!-- 备选方式 -->
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-md);padding:14px 18px;margin-bottom:12px">
      <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:6px">备选 · 浏览器控制台</div>
      <div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px">
        在 platform.deepseek.com 页面按 F12 → Console → 粘贴 → 回车
      </div>
      <div style="background:rgba(0,0,0,.2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:0;font-family:'SF Mono','Cascadia Code',Consolas,monospace;font-size:12px;color:var(--accent);word-break:break-all;user-select:all;cursor:text">
        (function(){var t=localStorage.userToken||localStorage.token||localStorage.auth||localStorage.authToken||'';try{var p=JSON.parse(t);t=p.value||t}catch(e){}fetch('http://127.0.0.1:9877/auth',{method:'POST',body:JSON.stringify({cookie:document.cookie,token:t})})})()
      </div>
    </div>

    <!-- 其他方式 -->
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-md);padding:14px 18px;margin-bottom:16px">
      <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:10px">其他方式</div>
      <div class="btn-row">
        <button class="btn" id="btn-extract-cookie">自动提取 Cookie</button>
        <button class="btn" id="btn-input-cookie">手动输入 Cookie</button>
        <button class="btn danger" id="btn-clear-cookie">清除 Cookie</button>
      </div>
      <div style="font-size:11px;color:var(--text-tertiary);margin-top:8px">
        Tampermonkey 脚本：安装 <a href="https://www.tampermonkey.net/" style="color:var(--accent)">扩展</a> → 粘贴 <code style="color:var(--accent)">scripts/deepseek-auto-sync.user.js</code> → 访问页面自动同步
      </div>
    </div>

    <div class="divider"></div>

    <!-- API Key -->
    <div class="key-status" style="margin-bottom:12px">
      <span class="dot ${apiKeyConfigured ? 'set' : 'unset'}"></span>
      <span id="key-status-text">API Key: ${apiKeyConfigured ? '已配置' : '未配置'}</span>
    </div>
    <div class="btn-row">
      <button class="btn" id="btn-set-key">设置 API Key</button>
      <button class="btn danger" id="btn-clear-key">清除</button>
    </div>
  </div>

  <script nonce="${nonce}" src="${echartsUri}"></script>
  <script nonce="${nonce}">
    var vscode=acquireVsCodeApi();
    var chartBalance=null;
    var lastCurrency='CNY',lastTotalBalance=0;

    var CC={
      text:getComputedStyle(document.documentElement).getPropertyValue('--text').trim()||'#e4e4e8',
      accent:getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()||'#818cf8',
      green:getComputedStyle(document.documentElement).getPropertyValue('--green').trim()||'#6ee7b7',
      orange:getComputedStyle(document.documentElement).getPropertyValue('--orange').trim()||'#f59e5c',
      grid:'rgba(255,255,255,.10)',
    };

    // period switch
    document.querySelectorAll('.period-btn').forEach(function(b){b.addEventListener('click',function(){
      var p=this.getAttribute('data-period');
      this.parentElement.querySelectorAll('.period-btn').forEach(function(x){x.classList.remove('active')});
      this.classList.add('active');
      document.getElementById('usage-today').style.display=p==='today'?'grid':'none';
      document.getElementById('usage-month').style.display=p==='month'?'grid':'none';
    })});

    // charts
    function createBalanceChart(){
      var d=document.getElementById('chart-balance');
      chartBalance=echarts.init(d);
      chartBalance.setOption({
        backgroundColor:'transparent',textStyle:{color:CC.text},
        tooltip:{trigger:'axis',formatter:function(p){return new Date(p[0].axisValue).toLocaleString()+'<br/>余额: <b>¥'+p[0].value.toFixed(2)+'</b>'}},
        grid:{left:70,right:24,top:20,bottom:32},
        xAxis:{type:'time',axisLine:{lineStyle:{color:CC.grid}},axisLabel:{color:CC.text,fontSize:10,fontFamily:'var(--font)'}},
        yAxis:{type:'value',name:'¥',nameTextStyle:{color:CC.text},axisLabel:{color:CC.text,fontSize:10},splitLine:{lineStyle:{color:CC.grid}}},
        series:[{type:'line',data:[],smooth:true,symbol:'none',lineStyle:{color:CC.accent,width:2},areaStyle:{color:new echarts.graphic.LinearGradient(0,0,0,1,[{offset:0,color:'rgba(129,140,248,.2)'},{offset:1,color:'rgba(129,140,248,0)'}])}}],
      });
    }

    // heatmap
    var WD=['一','','三','','五','','日'],MN=['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

    function renderModelBreakdown(models){
      if(!models||!models.length)return;
      var pm={'deepseek-v4-pro':'Pro','deepseek-v4-flash':'Flash','deepseek-chat & deepseek-reasoner':'Reasoner'};
      var html='';
      for(var i=0;i<models.length;i++){
        var m=models[i],label=pm[m.model]||m.model;
        html+='<div class="card"><div class="card-label">'+label+'</div><div class="card-value sm orange">¥'+m.cost.toFixed(2)+'</div><div class="card-sub">'+fmtTokens(m.tokens)+' Token · 缓存命中 '+fmtTokens(m.cacheHitTokens)+'</div></div>';
      }
      var el=document.getElementById('model-cards');
      el.innerHTML=html;
      el.className='cards col'+Math.min(models.length,2);
    }

    function renderHeatmap(dh){
      if(!dh||!dh.length)return;
      var dataMap={},maxT=0;
      for(var i=0;i<dh.length;i++){dataMap[dh[i].date]=dh[i].totalTokens;if(dh[i].totalTokens>maxT)maxT=dh[i].totalTokens}
      if(maxT===0)maxT=1;
      var today=new Date();today.setHours(0,0,0,0);
      var totalDays=26*7,start=new Date(today);
      start.setDate(start.getDate()-totalDays+1);
      var dow=start.getDay();if(dow===0)start.setDate(start.getDate()-6);else start.setDate(start.getDate()-dow+1);

      var cols=[],monthRanges=[],cur=new Date(start),lastMonth=-1;
      while(cur<=today){
        var week=[];
        for(var d=0;d<7;d++){var ds=cur.toISOString().split('T')[0];week.push({date:ds,tokens:dataMap[ds]||0});cur.setDate(cur.getDate()+1)}
        var mid=new Date(week[3].date),mth=mid.getMonth();
        if(mth!==lastMonth){monthRanges.push({label:MN[mth],col:cols.length});lastMonth=mth}
        cols.push(week)
      }

      var mthHtml='';
      for(var m=0;m<monthRanges.length;m++){
        var mr=monthRanges[m],nc=m+1<monthRanges.length?monthRanges[m+1].col:cols.length,span=nc-mr.col;
        mthHtml+='<span class="mth" style="width:'+(span*15)+'px;min-width:'+(span*15)+'px">'+mr.label+'</span>'
      }
      document.getElementById('heatmap-months').innerHTML=mthHtml;

      var wdHtml='';
      for(var w=0;w<7;w++)wdHtml+='<span class="wd">'+WD[w]+'</span>';
      document.querySelector('.heatmap-weekdays').innerHTML=wdHtml;

      var gridHtml='';
      for(var row=0;row<7;row++){
        gridHtml+='<div class="heatmap-row">';
        for(var col=0;col<cols.length;col++){
          var cell=cols[col][row],lvl=cell.tokens>0?Math.ceil((cell.tokens/maxT)*4):0;
          gridHtml+='<div class="heatmap-cell lv'+lvl+'" data-date="'+cell.date+'" data-tokens="'+cell.tokens+'"></div>'
        }
        gridHtml+='</div>'
      }
      document.getElementById('heatmap-grid').innerHTML=gridHtml;

      var tt=document.getElementById('heatmap-tt'),cells=document.querySelectorAll('.heatmap-cell');
      for(var i=0;i<cells.length;i++){cells[i].addEventListener('mouseenter',function(e){
        tt.textContent=this.getAttribute('data-date')+'  '+fmtTokens(parseInt(this.getAttribute('data-tokens')));
        tt.style.display='block'
      });cells[i].addEventListener('mousemove',function(e){
        var x=e.clientX+12,y=e.clientY-30,tw=tt.offsetWidth||120;
        if(x+tw>window.innerWidth-10)x=e.clientX-tw-12;if(y<10)y=e.clientY+20;
        tt.style.left=x+'px';tt.style.top=y+'px'
      });cells[i].addEventListener('mouseleave',function(){tt.style.display='none'})}
    }

    window.addEventListener('load',function(){createBalanceChart();vscode.postMessage({type:'webviewReady'});vscode.postMessage({type:'requestRefresh'})});

    window.addEventListener('message',function(e){
      var m=e.data;
      switch(m.type){
        case'updateBalance':showBalance(m.current,m.history30d);updateTime(m.current.isoTime);hideError();setStatus('ok');break;
        case'updateUsage':showUsage(m.data,m.userSummary,m.platformReachable);break;
        case'apiKeyStatus':updateCookieStatus(m.configured);break;
        case'cookieStatus':updateCookieStatus(m.configured);showCookieAge(m.lastUpdated);break;
        case'error':showError(m.message);setStatus('error');break
      }
    });

    function showBalance(cur,h30){
      lastCurrency=cur.currency||'CNY';lastTotalBalance=cur.totalBalance||0;
      var s=lastCurrency==='CNY'?'¥':'$';
      document.getElementById('card-total').textContent=s+cur.totalBalance.toFixed(2);
      document.getElementById('card-available').textContent=cur.isAvailable?'可用':'余额不足';
      if(chartBalance&&h30&&h30.length){chartBalance.setOption({series:[{data:h30.map(function(d){return[d.isoTime,d.totalBalance]})}]});chartBalance.resize()}
    }

    function showUsage(data,us,pr){
      if(!data)return;
      if(data.modelBreakdown)renderModelBreakdown(data.modelBreakdown);
      if(data.today){renderCard('ut',data.today);document.getElementById('ut-cost-display').textContent='¥'+data.today.estimatedCost.toFixed(2)}
      if(data.monthly){
        renderCard('um',data.monthly);
        document.getElementById('card-total-cost').textContent='¥'+data.monthly.estimatedCost.toFixed(2);
        document.getElementById('um-cost-display').textContent='¥'+data.monthly.estimatedCost.toFixed(2)
      }
      if(data.dailyHistory&&data.dailyHistory.length){
        renderHeatmap(data.dailyHistory);
        // Sum all daily costs for total lifetime
        var allTimeCost=data.dailyHistory.reduce(function(s,d){return s+(d.estimatedCost||0)},0);
        document.getElementById('card-alltime-cost').textContent='¥'+allTimeCost.toFixed(2);
      }
      // Token 估算 (M units)
      var et=0;
      if(data.today&&data.today.totalTokens>0&&data.today.estimatedCost>0){
        var r=data.today.estimatedCost/data.today.totalTokens;
        if(r>0)et=Math.round(lastTotalBalance/r)/1e6;
      }
      if(et<=0&&data.monthly&&data.monthly.totalTokens>0&&data.monthly.estimatedCost>0){
        var r2=data.monthly.estimatedCost/data.monthly.totalTokens;
        if(r2>0)et=Math.round(lastTotalBalance/r2)/1e6;
      }
      if(et<=0&&lastTotalBalance>0)et=lastTotalBalance;
      if(et>0)document.getElementById('card-token-est').textContent=et.toFixed(1)+'M';
      if(us&&us.totalCost!==undefined)document.getElementById('card-total-cost').textContent='¥'+us.totalCost.toFixed(2);
      // Show warning if platform unreachable
      if(pr===false&&data.today.totalTokens===0){
        showError('平台连接失败 —— JWT Token 可能已过期 (每日需刷新)。请在下方设置区域重新发送 Cookie。');
        setStatus('error');
      }
    }

    function renderCard(p,s){
      if(!s)return;
      var ce=document.getElementById(p+'-cost');if(ce)ce.textContent='¥'+s.estimatedCost.toFixed(2);
      var te=document.getElementById(p+'-tokens');if(te)te.textContent=fmtTokens(s.totalTokens);
      document.getElementById(p+'-in').textContent=fmtTokens(s.promptTokens);
      document.getElementById(p+'-out').textContent=fmtTokens(s.completionTokens);
      document.getElementById(p+'-requests').textContent=s.recordCount;
      var ca=document.getElementById(p+'-cache'),cd=document.getElementById(p+'-cache-detail'),cw=document.getElementById(p+'-cache-bar-wrap'),cb=document.getElementById(p+'-cache-bar');
      if(s.cacheHitRate!==null){
        if(ca)ca.textContent=s.cacheHitRate.toFixed(2)+'%';
        if(cd)cd.textContent='命中 '+fmtTokens(s.cacheHitTokens)+' · 未命中 '+fmtTokens(s.cacheMissTokens);
        if(cw)cw.style.display='block';if(cb)cb.style.width=Math.min(100,s.cacheHitRate)+'%'
      }else{if(ca)ca.textContent='--';if(cw)cw.style.display='none'}
    }

    function fmtTokens(n){if(n>=1e6)return(n/1e6).toFixed(1)+'M';if(n>=1e3)return(n/1e3).toFixed(1)+'K';return String(n)}
    function fmtNum(n){if(n>=1e6)return(n/1e6).toFixed(1)+'M';return String(Math.round(n))}

    function updateTime(t){document.getElementById('last-refresh').textContent=new Date(t).toLocaleString('zh-CN')}
    function updateCookieStatus(c){
      var d=document.getElementById('cookie-dot'),t=document.getElementById('cookie-status-text');
      if(c){d.className='dot set';t.textContent='平台连接: 已连接'}else{d.className='dot unset';t.textContent='平台连接: 未连接'}
    }
    function showCookieAge(iso){
      var el=document.getElementById('cookie-age');
      if(!el)return;
      if(!iso){el.textContent='';return}
      var ms=Date.now()-new Date(iso).getTime();
      var hours=Math.round(ms/3600000);
      if(hours<1)el.textContent='(刚刚)';
      else if(hours<24)el.textContent='('+hours+'小时前)';
      else el.textContent='('+Math.round(hours/24)+'天前)';
    }
    function showError(m){var b=document.getElementById('error-banner');b.textContent=m;b.className='error-banner visible'}
    function hideError(){document.getElementById('error-banner').className='error-banner'}
    function setStatus(st){var d=document.getElementById('status-dot'),t=document.getElementById('status-text');if(st==='ok'){d.className='status-dot ok';t.textContent='运行中'}else{d.className='status-dot error';t.textContent='异常'}}

    document.getElementById('btn-refresh').addEventListener('click',function(){vscode.postMessage({type:'requestRefresh'})});
    document.getElementById('btn-set-key').addEventListener('click',function(){vscode.postMessage({type:'requestSetApiKey'})});
    document.getElementById('btn-clear-key').addEventListener('click',function(){vscode.postMessage({type:'clearApiKey'})});
    document.getElementById('btn-sync-playwright').addEventListener('click',function(){vscode.postMessage({type:'syncPlaywright'})});
    document.getElementById('btn-extract-cookie').addEventListener('click',function(){vscode.postMessage({type:'extractCookie'})});
    document.getElementById('btn-input-cookie').addEventListener('click',function(){vscode.postMessage({type:'inputCookie'})});
    document.getElementById('btn-clear-cookie').addEventListener('click',function(){vscode.postMessage({type:'clearCookie'})});
    window.addEventListener('resize',function(){if(chartBalance)chartBalance.resize()})
  </script>
</body>
</html>`;
}
