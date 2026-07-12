export const JS_ATTENDANCE = String.raw`// ── ATTENDANCE ────────────────────────────────────────────────────────
var MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function loadAttendance() {
  var from = document.getElementById('att-from').value;
  var to = document.getElementById('att-to').value;
  var q = '/admin/api/attendance?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to) + '&order=' + _attOrder;
  api(q).then(function(d) {
    _loadedServices = d.services || [];
    _attTotalInDb = d.total_in_db || 0;
    renderAttendanceChart(_loadedServices);
    renderAttendanceList(_loadedServices, _attTotalInDb);
  });
}
function renderAttendanceListFromLoaded() {
  _attGroupBy = (document.getElementById('att-group-by') || {}).value || 'none';
  renderAttendanceList(_loadedServices, _attTotalInDb || 0);
}
var _attTotalInDb = 0;
function toggleAttTable() {
  _attTableVisible = !_attTableVisible;
  var el = document.getElementById('att-list');
  var btn = document.getElementById('att-table-toggle');
  if (el)  el.style.display  = _attTableVisible ? '' : 'none';
  if (btn) btn.innerHTML = _attTableVisible ? '&#9660; Hide Table' : '&#9654; Show Table';
}
function toggleAttOrder() {
  _attOrder = _attOrder === 'desc' ? 'asc' : 'desc';
  var btn = document.getElementById('att-order-btn');
  if (btn) btn.textContent = _attOrder === 'asc' ? '&#8593; Asc' : '&#8595; Desc';
  loadAttendance();
}
function setAttChartMode(m) {
  _attChartMode = m;
  ['line','yoy','bars'].forEach(function(k){
    var b = document.getElementById('att-mode-'+k);
    if (b) b.style.opacity = m === k ? '1' : '.55';
  });
  renderAttendanceChart(_loadedServices);
}

function _chartResizeHandle(fnName) {
  return '<div style="height:14px;cursor:ns-resize;display:flex;align-items:center;justify-content:center;margin:2px 0;opacity:0.4;touch-action:none;" onmousedown="'+fnName+'(event)" ontouchstart="'+fnName+'(event)" title="Drag to resize chart"><div style="width:32px;height:3px;background:var(--warm-gray);border-radius:2px;"></div></div>';
}

// Returns vertical screen position whether the event is mouse or touch.
function _ptrY(e) {
  if (e.touches && e.touches.length) return e.touches[0].clientY;
  if (e.changedTouches && e.changedTouches.length) return e.changedTouches[0].clientY;
  return e.clientY;
}

var _attResizing = false, _attResizeStartY = 0, _attResizeStartH = 0, _attResizeRaf = 0;
function attChartResizeStart(e) {
  _attResizing = true;
  _attResizeStartY = _ptrY(e);
  _attResizeStartH = _attChartH;
  if (e.preventDefault) e.preventDefault();
  document.addEventListener('mousemove', _attResizeMove);
  document.addEventListener('mouseup', _attResizeEnd);
  document.addEventListener('touchmove', _attResizeMove, { passive: false });
  document.addEventListener('touchend', _attResizeEnd);
  document.addEventListener('touchcancel', _attResizeEnd);
}
var _attResizeMove = function(e) {
  if (!_attResizing) return;
  if (e.cancelable && e.touches) e.preventDefault();
  var y = _ptrY(e);
  cancelAnimationFrame(_attResizeRaf);
  _attResizeRaf = requestAnimationFrame(function() {
    _attChartH = Math.max(120, Math.min(600, _attResizeStartH + y - _attResizeStartY));
    renderAttendanceChart(_loadedServices);
  });
};
var _attResizeEnd = function() {
  _attResizing = false;
  document.removeEventListener('mousemove', _attResizeMove);
  document.removeEventListener('mouseup', _attResizeEnd);
  document.removeEventListener('touchmove', _attResizeMove);
  document.removeEventListener('touchend', _attResizeEnd);
  document.removeEventListener('touchcancel', _attResizeEnd);
};

// ── Report chart resize (YoY att, by-service att, giving trend) ───────
var _rptResizing = false, _rptResizeStartY = 0, _rptResizeStartH = 0, _rptResizeRaf = 0, _rptResizeKey = '';
function _rptResizeStart(e, key, h0) {
  _rptResizing = true; _rptResizeKey = key; _rptResizeStartY = _ptrY(e); _rptResizeStartH = h0;
  if (e.preventDefault) e.preventDefault();
  document.addEventListener('mousemove', _rptResizeMoveH);
  document.addEventListener('mouseup', _rptResizeEndH);
  document.addEventListener('touchmove', _rptResizeMoveH, { passive: false });
  document.addEventListener('touchend', _rptResizeEndH);
  document.addEventListener('touchcancel', _rptResizeEndH);
}
var _rptResizeMoveH = function(e) {
  if (!_rptResizing) return;
  if (e.cancelable && e.touches) e.preventDefault();
  var y = _ptrY(e);
  cancelAnimationFrame(_rptResizeRaf);
  _rptResizeRaf = requestAnimationFrame(function() {
    var newH = Math.max(120, Math.min(600, _rptResizeStartH + y - _rptResizeStartY));
    if (_rptResizeKey === 'yoy') {
      _yoyRptH = newH;
      var w = document.getElementById('att-yoy-chart-wrap');
      if (w && _lastYoYRptData) w.innerHTML = renderYoYChart(_lastYoYRptData, newH);
    } else if (_rptResizeKey === 'byService') {
      _byServiceRptH = newH;
      var w = document.getElementById('att-service-chart-wrap');
      if (w && _lastByServiceRptData) w.innerHTML = _lastByServiceRptData.mode === 'multi-year'
        ? renderMultiYearServiceChart(_lastByServiceRptData, newH)
        : renderByServiceChart(_lastByServiceRptData, newH);
    } else if (_rptResizeKey === 'givingTrend') {
      _givingTrendH = newH;
      var w = document.getElementById('giving-trend-svg-wrap');
      // Redraw via the single shared renderer (js-reports.js) instead of a second hand-inlined
      // copy of the same chart — the inlined copy had drifted (hardcoded Dec-25-marker year)
      // before this fix. renderGivingTrendChart() returns a full card wrapper with its own
      // #giving-trend-svg-wrap; re-target just the <svg> so the drag-resize keeps updating
      // in place without replacing the wrapper element mid-drag.
      if (w && _lastGivingTrendData) {
        var fullCard = renderGivingTrendChart(_lastGivingTrendData, newH);
        var svgMatch = fullCard.match(/<svg[\s\S]*?<\/svg>/);
        if (svgMatch) w.innerHTML = svgMatch[0];
      }
    }
  });
};
var _rptResizeEndH = function() {
  _rptResizing = false;
  document.removeEventListener('mousemove', _rptResizeMoveH);
  document.removeEventListener('mouseup', _rptResizeEndH);
  document.removeEventListener('touchmove', _rptResizeMoveH);
  document.removeEventListener('touchend', _rptResizeEndH);
  document.removeEventListener('touchcancel', _rptResizeEndH);
};
function yoyRptResizeStart(e) { _rptResizeStart(e, 'yoy', _yoyRptH); }
function byServiceResizeStart(e) { _rptResizeStart(e, 'byService', _byServiceRptH); }
function givingTrendResizeStart(e) { _rptResizeStart(e, 'givingTrend', _givingTrendH); }

function renderAttendanceChart(services) {
  renderSpecialServicesChart(services);
  var today = new Date().toISOString().slice(0,10);
  var byDate = {};
  services.forEach(function(s) {
    if (s.service_type === 'sunday' && s.service_date <= today) {
      byDate[s.service_date] = (byDate[s.service_date]||0) + (s.attendance||0);
    }
  });
  var allDates = Object.keys(byDate).sort();
  var dataPts = allDates.filter(function(d){return byDate[d]>0;});

  var statsEl = document.getElementById('att-stats');
  if (!dataPts.length) {
    if (statsEl) statsEl.innerHTML = '<span style="color:var(--warm-gray);font-size:.85rem;">No past attendance data in this range. Try widening the date filter to include earlier years, or run Sync Counts from Breeze.</span>';
    var cw = document.getElementById('att-chart-wrap');
    if (cw) cw.innerHTML = '';
    return;
  }
  var vals = dataPts.map(function(d){return byDate[d];});
  var avg = Math.round(vals.reduce(function(a,b){return a+b;},0)/vals.length);
  var latest = byDate[dataPts[dataPts.length-1]];
  var latestDate = dataPts[dataPts.length-1].split('-');
  var latestLbl = MONTH_NAMES[parseInt(latestDate[1])-1]+' '+parseInt(latestDate[2]);
  var peakVal = Math.max.apply(null, vals);
  var peakIdx = vals.indexOf(peakVal);
  var peakParts = dataPts[peakIdx].split('-');
  var peakLbl = MONTH_NAMES[parseInt(peakParts[1])-1]+' '+parseInt(peakParts[2])+', '+peakParts[0];
  var curYear = today.slice(0,4);
  var priorYear = String(parseInt(curYear)-1);
  var todayMD = today.slice(5);
  var annualTotal = dataPts.reduce(function(s,d){return d.slice(0,4)===curYear?s+byDate[d]:s;},0);
  var ytdCur = annualTotal;
  var ytdPrior = dataPts.reduce(function(s,d){return d.slice(0,4)===priorYear&&d.slice(5)<=todayMD?s+byDate[d]:s;},0);
  var ytdHtml = '';
  if (ytdCur>0 && ytdPrior>0) {
    var pct = Math.round((ytdCur-ytdPrior)/ytdPrior*100);
    var pctColor = pct>=0 ? '#3a7d44' : '#b03a2e';
    ytdHtml = '<div><div class="att-stat-val" style="color:'+pctColor+';">'+(pct>=0?'+':'')+pct+'%</div><div class="att-stat-lbl">YTD vs '+priorYear+'</div></div>';
  }
  if (statsEl) statsEl.innerHTML =
    '<div class="att-stat-primary"><div class="att-stat-val">'+latest+'</div><div class="att-stat-lbl">Latest \u00b7 '+latestLbl+'</div></div>'
    +'<div class="att-stat-divider"></div>'
    +'<div><div class="att-stat-val">'+avg+'</div><div class="att-stat-lbl">Weekly Avg</div></div>'
    +'<div><div class="att-stat-val">'+peakVal+'</div><div class="att-stat-lbl">Peak \u00b7 '+peakLbl+'</div></div>'
    +(annualTotal?'<div><div class="att-stat-val">'+annualTotal+'</div><div class="att-stat-lbl">'+curYear+' Total</div></div>':'')
    +ytdHtml
    +'<div><div class="att-stat-val">'+dataPts.length+'</div><div class="att-stat-lbl">Sundays</div></div>';

  var n=dataPts.length;
  var H=_attChartH,pL=32,pR=12,pT=10,pB=30;
  var cw=document.getElementById('att-chart-wrap');

  if (_attChartMode === 'yoy') {
    // Build YoY data from loaded services
    var byYM={}, yrsAll=[];
    services.forEach(function(s){
      if(s.service_type!=='sunday'||!s.attendance||s.service_date>today) return;
      var yr2=s.service_date.slice(0,4), mo2=s.service_date.slice(5,7);
      if(!byYM[yr2]){byYM[yr2]={};yrsAll.push(yr2);}
      if(!byYM[yr2][mo2]){byYM[yr2][mo2]={sum:0,cnt:{}};}
      byYM[yr2][mo2].sum+=s.attendance;
      byYM[yr2][mo2].cnt[s.service_date]=1;
    });
    yrsAll=yrsAll.filter(function(v,i,a){return a.indexOf(v)===i;}).sort();
    var dYoY={years:yrsAll, monthly:{}};
    yrsAll.forEach(function(yr2){
      dYoY.monthly[yr2]=[];
      Object.keys(byYM[yr2]).sort().forEach(function(mo2){
        var b=byYM[yr2][mo2], nSun=Object.keys(b.cnt).length;
        dYoY.monthly[yr2].push({month:mo2, total:Math.round(b.sum/nSun)});
      });
    });
    if(statsEl) statsEl.innerHTML='<span style="font-size:.82rem;color:var(--warm-gray);">Year-over-Year — avg Sunday attendance per month. Use date filter to choose years.</span>';
    if(cw) cw.innerHTML=renderYoYChart(dYoY, _attChartH);
    return;
  }

  if (_attChartMode === 'bars') {
    var byMonth={}, bMonths=[];
    dataPts.forEach(function(d){
      var mk=d.slice(0,7);
      if(!byMonth[mk]){byMonth[mk]=0;bMonths.push(mk);}
      byMonth[mk]+=byDate[d];
    });
    var bVals=bMonths.map(function(m){return byMonth[m];});
    var maxV2=Math.max.apply(null,bVals)*1.1||1;
    var nb=bMonths.length;
    var W=Math.max(800, nb*28); // scalable: 28px min per bar
    var cH2=H-pT-pB;
    var slotW=(W-pL-pR)/nb;
    var barW=Math.max(4,Math.min(32,slotW*0.7));
    var px2=function(i){return pL+(i+0.5)*slotW;};
    var py2=function(v){return pT+cH2-(v/maxV2)*cH2;};
    var baseY=pT+cH2;
    var grid2='',ylbls2='',xlbls2='',bars2='';
    [0,Math.round(maxV2*0.5/1.1),Math.round(maxV2/1.1)].forEach(function(v){
      var yy=py2(v);
      grid2+='<line x1="'+pL+'" y1="'+yy.toFixed(1)+'" x2="'+(W-pR)+'" y2="'+yy.toFixed(1)+'" stroke="#f0ece8" stroke-width="1"/>';
      ylbls2+='<text x="'+(pL-3)+'" y="'+(yy+3).toFixed(1)+'" text-anchor="end" fill="#9A8A78" font-size="9">'+Math.round(v)+'</text>';
    });
    var stepB=Math.max(1,Math.ceil(nb/10));
    for(var bi=0;bi<nb;bi+=stepB){
      var mp=bMonths[bi].split('-');
      xlbls2+='<text x="'+px2(bi).toFixed(1)+'" y="'+(H-5)+'" text-anchor="middle" fill="#9A8A78" font-size="9">'+MONTH_NAMES[parseInt(mp[1])-1]+' '+mp[0].slice(2)+'</text>';
    }
    bars2=bMonths.map(function(m,bi2){
      var bx=px2(bi2),bv=byMonth[m],by=py2(bv),bh=baseY-by;
      return '<rect x="'+(bx-barW/2).toFixed(1)+'" y="'+by.toFixed(1)+'" width="'+barW.toFixed(1)+'" height="'+bh.toFixed(1)+'" fill="#2E7EA6" rx="2" opacity="0.85"><title>'+m+': '+bv+'</title></rect>';
    }).join('');
    if(cw) cw.innerHTML='<svg viewBox="0 0 '+W+' '+H+'" style="min-width:'+W+'px;width:100%;height:'+H+'px;">'+grid2+bars2+xlbls2+ylbls2+'</svg>';
    return;
  }

  var W=Math.max(800, n*10); // scalable: at least 10px per Sunday
  var cW=W-pL-pR, cH=H-pT-pB;
  var maxV=Math.max.apply(null,vals)*1.1||1;
  var px=function(i){return pL+(i/(n>1?n-1:1))*cW;};
  var py=function(v){return pT+cH-(v/maxV)*cH;};
  var pts=dataPts.map(function(d,i){return [px(i),py(byDate[d])];});
  var line=pts.map(function(p,i){return(i?'L ':'M ')+p[0].toFixed(1)+','+p[1].toFixed(1);}).join(' ');
  var area=line+' L '+px(n-1).toFixed(1)+','+(pT+cH)+' L '+pL+','+(pT+cH)+' Z';
  var yearsInRange={};
  dataPts.forEach(function(d){yearsInRange[d.slice(0,4)]=1;});
  var multiYear=Object.keys(yearsInRange).length>1;
  var step=Math.max(1,Math.ceil(n/10));
  var xlbls='',ylbls='',grid='';
  [0,Math.round(maxV*0.5/1.1),Math.round(maxV/1.1)].forEach(function(v){
    var yy=py(v);
    grid+='<line x1="'+pL+'" y1="'+yy.toFixed(1)+'" x2="'+(W-pR)+'" y2="'+yy.toFixed(1)+'" stroke="#f0ece8" stroke-width="1"/>';
    ylbls+='<text x="'+(pL-3)+'" y="'+(yy+3).toFixed(1)+'" text-anchor="end" fill="#9A8A78" font-size="9">'+v+'</text>';
  });
  for(var i=0;i<n;i+=step){
    var p=dataPts[i].split('-');
    var xlbl=MONTH_NAMES[parseInt(p[1])-1]+' '+parseInt(p[2])+(multiYear?' \''+p[0].slice(2):'');
    xlbls+='<text x="'+px(i).toFixed(1)+'" y="'+(H-5)+'" text-anchor="middle" fill="#9A8A78" font-size="9">'+xlbl+'</text>';
  }
  var avgPts=[];
  for(var ai=3;ai<n;ai++){
    avgPts.push([px(ai),py((vals[ai]+vals[ai-1]+vals[ai-2]+vals[ai-3])/4)]);
  }
  var avgLine=avgPts.length>1?'<path d="'+avgPts.map(function(p2,j){return(j?'L ':'M ')+p2[0].toFixed(1)+','+p2[1].toFixed(1);}).join(' ')+'" fill="none" stroke="#C9973A" stroke-width="2" stroke-dasharray="4 3" stroke-linejoin="round"/>':'';
  // Interpolate x position for any date even if it's not a Sunday data point
  var xAtAnyDate=function(ds){
    if(!dataPts.length||ds<dataPts[0]||ds>dataPts[dataPts.length-1])return -1;
    var lo=0,hi=dataPts.length-1;
    while(lo<hi-1){var mid=Math.floor((lo+hi)/2);if(dataPts[mid]<=ds)lo=mid;else hi=mid;}
    if(dataPts[lo]===ds)return px(lo);
    if(dataPts[hi]===ds)return px(hi);
    var t=(new Date(ds)-new Date(dataPts[lo]))/(new Date(dataPts[hi])-new Date(dataPts[lo]));
    return px(lo)+t*(px(hi)-px(lo));
  };
  var markers='';
  Object.keys(yearsInRange).forEach(function(yr){
    var yr2=multiYear?' \''+yr.slice(2):'';
    var ey=parseInt(yr),ea=ey%19,eb=Math.floor(ey/100),ec=ey%100;
    var edd=Math.floor(eb/4),ee=eb%4,ef=Math.floor((eb+8)/25);
    var eg=Math.floor((eb-ef+1)/3),eh=(19*ea+eb-edd-eg+15)%30;
    var eii=Math.floor(ec/4),ek=ec%4,el=(32+2*ee+2*eii-eh-ek)%7;
    var emm=Math.floor((ea+11*eh+22*el)/451);
    var emo=Math.floor((eh+el-7*emm+114)/31),edy2=(eh+el-7*emm+114)%31+1;
    var eDate=yr+'-'+(emo<10?'0'+emo:''+emo)+'-'+(edy2<10?'0'+edy2:''+edy2);
    var ex=xAtAnyDate(eDate);
    if(ex>=0){
      markers+='<line x1="'+ex.toFixed(1)+'" y1="'+pT+'" x2="'+ex.toFixed(1)+'" y2="'+(pT+cH)+'" stroke="#5A9E6F" stroke-width="1" stroke-dasharray="3 3" opacity="0.7"/>';
      markers+='<text x="'+ex.toFixed(1)+'" y="'+(pT+9)+'" text-anchor="middle" fill="#5A9E6F" font-size="8">Easter'+yr2+'</text>';
    }
    [yr+'-12-24',yr+'-12-25'].forEach(function(xd,xi){
      var xx=xAtAnyDate(xd);
      if(xx>=0){
        markers+='<line x1="'+xx.toFixed(1)+'" y1="'+pT+'" x2="'+xx.toFixed(1)+'" y2="'+(pT+cH)+'" stroke="#9B59B6" stroke-width="1" stroke-dasharray="3 3" opacity="0.7"/>';
        markers+='<text x="'+xx.toFixed(1)+'" y="'+(pT+9)+'" text-anchor="middle" fill="#9B59B6" font-size="8">'+(xi===0?'Xmas Eve':'Christmas')+yr2+'</text>';
      }
    });
  });
  var dots=pts.map(function(p,i){
    var d=dataPts[i].split('-');
    var tip=MONTH_NAMES[parseInt(d[1])-1]+' '+parseInt(d[2])+' '+d[0]+': '+byDate[dataPts[i]];
    return '<circle cx="'+p[0].toFixed(1)+'" cy="'+p[1].toFixed(1)+'" r="3" fill="#2E7EA6" style="cursor:default;"><title>'+tip+'</title></circle>';
  }).join('');
  var avgLegend='<div style="display:flex;gap:16px;margin-top:4px;flex-wrap:wrap;">'
    +'<span style="display:flex;align-items:center;gap:4px;font-size:.75rem;color:var(--warm-gray);"><span style="display:inline-block;width:20px;height:2px;background:#2E7EA6;"></span>Weekly</span>'
    +(avgLine?'<span style="display:flex;align-items:center;gap:4px;font-size:.75rem;color:var(--warm-gray);"><span style="display:inline-block;width:20px;height:2px;background:#C9973A;border-top:2px dashed #C9973A;"></span>4-wk avg</span>':'')
    +'<span style="display:flex;align-items:center;gap:4px;font-size:.75rem;color:var(--warm-gray);"><span style="display:inline-block;width:2px;height:12px;background:#5A9E6F;border-left:2px dashed #5A9E6F;"></span>Easter</span>'
    +'<span style="display:flex;align-items:center;gap:4px;font-size:.75rem;color:var(--warm-gray);"><span style="display:inline-block;width:2px;height:12px;background:#9B59B6;border-left:2px dashed #9B59B6;"></span>Christmas</span>'
    +'</div>';
  if(cw) cw.innerHTML='<svg id="att-chart-svg" viewBox="0 0 '+W+' '+H+'" style="min-width:'+W+'px;width:100%;height:'+H+'px;">'+grid
    +'<path d="'+area+'" fill="rgba(46,126,166,0.12)"/>'
    +'<path d="'+line+'" fill="none" stroke="#2E7EA6" stroke-width="2" stroke-linejoin="round"/>'
    +avgLine+markers+dots+xlbls+ylbls+'</svg>'+avgLegend;
}

function downloadAttChart() {
  var svg = document.getElementById('att-chart-svg');
  if (!svg) { alert('No chart to download. Switch to Line view first.'); return; }
  var svgData = new XMLSerializer().serializeToString(svg);
  var canvas = document.createElement('canvas');
  var vb = svg.viewBox.baseVal;
  canvas.width = vb.width * 2;
  canvas.height = vb.height * 2;
  var ctx = canvas.getContext('2d');
  ctx.fillStyle = '#faf7f2';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  var img = new Image();
  var blob = new Blob([svgData], {type: 'image/svg+xml;charset=utf-8'});
  var url = URL.createObjectURL(blob);
  img.onload = function() {
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    var link = document.createElement('a');
    link.download = 'attendance-' + new Date().toISOString().slice(0,10) + '.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  };
  img.src = url;
}

function renderSpecialServicesChart(services) {
  var wrap = document.getElementById('att-special-wrap');
  if (!wrap) return;
  var today = new Date().toISOString().slice(0,10);
  var specials = (services || []).filter(function(s) {
    return s.service_type !== 'sunday' && (s.attendance||0) > 0 && s.service_date <= today;
  }).sort(function(a,b){return a.service_date<b.service_date?-1:a.service_date>b.service_date?1:0;});
  if (!specials.length) { wrap.innerHTML=''; return; }
  var n=specials.length;
  var vals=specials.map(function(s){return s.attendance||0;});
  var maxV=Math.max.apply(null,vals)*1.15||1;
  var W=Math.max(400,n*44), H=130, pL=34, pR=12, pT=22, pB=28;
  var cW=W-pL-pR, cH=H-pT-pB;
  var slotW=cW/n, barW=Math.max(6,Math.min(30,slotW*0.65));
  var bx2=function(i){return pL+(i+0.5)*slotW;};
  var by2=function(v){return pT+cH-(v/maxV)*cH;};
  var baseY=pT+cH;
  var typeColor={special:'#C9973A',midweek:'#9B59B6'};
  var bars='',xlbls='',ylbls='',grid='';
  [0,Math.round(maxV/1.15)].forEach(function(v){
    var yy=by2(v);
    grid+='<line x1="'+pL+'" y1="'+yy.toFixed(1)+'" x2="'+(W-pR)+'" y2="'+yy.toFixed(1)+'" stroke="#f0ece8" stroke-width="1"/>';
    ylbls+='<text x="'+(pL-3)+'" y="'+(yy+3).toFixed(1)+'" text-anchor="end" fill="#9A8A78" font-size="9">'+Math.round(v)+'</text>';
  });
  var labelStep=Math.max(1,Math.ceil(n/14));
  specials.forEach(function(s,i){
    var bxv=bx2(i), bv=s.attendance||0, byv=by2(bv), bhv=baseY-byv;
    var color=typeColor[s.service_type]||'#888';
    var tip=s.service_date+' · '+esc(s.service_name||s.service_type)+': '+bv;
    bars+='<rect x="'+(bxv-barW/2).toFixed(1)+'" y="'+byv.toFixed(1)+'" width="'+barW.toFixed(1)+'" height="'+bhv.toFixed(1)+'" fill="'+color+'" rx="2" opacity="0.85"><title>'+tip+'</title></rect>';
    bars+='<text x="'+bxv.toFixed(1)+'" y="'+(byv-2).toFixed(1)+'" text-anchor="middle" fill="#5a4a3a" font-size="8">'+bv+'</text>';
    if(i%labelStep===0){
      var dp=s.service_date.split('-');
      xlbls+='<text x="'+bxv.toFixed(1)+'" y="'+(H-4)+'" text-anchor="middle" fill="#9A8A78" font-size="8">'+MONTH_NAMES[parseInt(dp[1])-1]+' '+parseInt(dp[2])+'\''+dp[0].slice(2)+'</text>';
    }
  });
  wrap.innerHTML='<div style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--warm-gray);margin-bottom:6px;">Special &amp; Midweek Services</div>'
    +'<div style="overflow-x:auto;"><svg viewBox="0 0 '+W+' '+H+'" style="min-width:'+W+'px;width:100%;height:'+H+'px;">'+grid+bars+xlbls+ylbls+'</svg></div>'
    +'<div style="display:flex;gap:14px;margin-top:4px;flex-wrap:wrap;">'
    +'<span style="display:flex;align-items:center;gap:5px;font-size:.75rem;color:var(--warm-gray);"><span style="display:inline-block;width:12px;height:10px;background:#C9973A;border-radius:2px;opacity:.85;"></span>Special (Christmas, Easter Vigil, etc.)</span>'
    +'<span style="display:flex;align-items:center;gap:5px;font-size:.75rem;color:var(--warm-gray);"><span style="display:inline-block;width:12px;height:10px;background:#9B59B6;border-radius:2px;opacity:.85;"></span>Midweek (Ash Wednesday, Lent, etc.)</span>'
    +'</div>';
}

function openSpecialServiceEntry() {
  var el = document.getElementById('att-add-form');
  el.style.display = '';
  el.innerHTML = '<div style="font-family:var(--font-head);font-size:1rem;color:var(--steel-anchor);margin-bottom:14px;">Add Special / Midweek Service</div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">'
    + '<div><label style="font-size:.72rem;font-weight:700;text-transform:uppercase;color:var(--warm-gray);">Date</label><input type="date" id="spf-date" value="'+new Date().toISOString().slice(0,10)+'" style="width:100%;padding:6px;border:1px solid var(--border);border-radius:6px;"></div>'
    + '<div><label style="font-size:.72rem;font-weight:700;text-transform:uppercase;color:var(--warm-gray);">Type</label>'
    + '<select id="spf-type" style="width:100%;padding:6px;border:1px solid var(--border);border-radius:6px;font-size:.9rem;">'
    + '<option value="special">Special (Christmas, Easter Vigil, Good Friday…)</option>'
    + '<option value="midweek">Midweek (Ash Wednesday, Lent, Advent…)</option>'
    + '</select></div>'
    + '</div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">'
    + '<div><label style="font-size:.72rem;font-weight:700;text-transform:uppercase;color:var(--warm-gray);">Service Name</label>'
    + '<input type="text" id="spf-name" list="spf-name-suggestions" placeholder="e.g. Christmas Eve" style="width:100%;padding:6px;border:1px solid var(--border);border-radius:6px;">'
    + '<datalist id="spf-name-suggestions"><option value="Christmas Eve"><option value="Christmas Day"><option value="Good Friday"><option value="Maundy Thursday"><option value="Easter Vigil"><option value="Ash Wednesday"><option value="Thanksgiving Eve"><option value="Advent Midweek"><option value="Lenten Midweek"></datalist></div>'
    + '<div><label style="font-size:.72rem;font-weight:700;text-transform:uppercase;color:var(--steel-anchor);">Attendance</label><input type="number" id="spf-att" min="0" placeholder="0" style="width:100%;padding:7px;border:1px solid var(--border);border-radius:6px;font-size:1rem;font-weight:700;"></div>'
    + '</div>'
    + '<div style="margin-bottom:12px;"><label style="font-size:.72rem;font-weight:700;text-transform:uppercase;color:var(--warm-gray);">Time (optional)</label><input type="time" id="spf-time" placeholder="e.g. 19:00" style="width:100%;padding:6px;border:1px solid var(--border);border-radius:6px;"></div>'
    + '<div style="display:flex;gap:8px;"><button class="btn-primary" onclick="saveSpecialService()">Save</button><button class="btn-secondary" onclick="document.getElementById(\'att-add-form\').style.display=\'none\'">Cancel</button></div>';
}

function saveSpecialService() {
  var date = document.getElementById('spf-date').value;
  var name = (document.getElementById('spf-name').value || '').trim();
  var att  = parseInt(document.getElementById('spf-att').value) || 0;
  var type = document.getElementById('spf-type').value;
  var time = document.getElementById('spf-time').value || '';
  if (!date) { alert('Please enter a date.'); return; }
  if (!name) { alert('Please enter a service name.'); return; }
  if (!att)  { alert('Please enter attendance.'); return; }
  api('/admin/api/attendance', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ service_date:date, service_name:name, service_type:type, service_time:time, attendance:att })
  }).then(function(d) {
    if (d.error) { alert('Error: ' + d.error); return; }
    document.getElementById('att-add-form').style.display = 'none';
    loadAttendance();
  });
}

function renderYoYChart(d, chartH) {
  var palette=['#2E7EA6','#C9973A','#5A9E6F','#9B59B6','#E74C3C'];
  var mShort=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var W=800,H=chartH||200,pL=36,pR=12,pT=12,pB=36,cW=W-pL-pR,cH=H-pT-pB;
  var allV=[];
  d.years.forEach(function(yr){
    for(var mo=1;mo<=12;mo++){
      var ms=mo<10?'0'+mo:''+mo;
      var row=(d.monthly[yr]||[]).find(function(r){return r.month===ms;});
      if(row&&row.total) allV.push(row.total);
    }
  });
  if(!allV.length) return '';
  var maxV=Math.max.apply(null,allV)*1.1;
  var pxY=function(i){return pL+i*(cW/11);};
  var pyY=function(v){return pT+cH-(v/maxV)*cH;};
  var grid='',ylbls='',xlbls='',lines='';
  [0,Math.round(maxV*0.5/1.1),Math.round(maxV/1.1)].forEach(function(v){
    var yy=pyY(v);
    grid+='<line x1="'+pL+'" y1="'+yy.toFixed(1)+'" x2="'+(W-pR)+'" y2="'+yy.toFixed(1)+'" stroke="#f0ece8" stroke-width="1"/>';
    ylbls+='<text x="'+(pL-3)+'" y="'+(yy+3).toFixed(1)+'" text-anchor="end" fill="#9A8A78" font-size="9">'+Math.round(v)+'</text>';
  });
  for(var xi=0;xi<12;xi++){
    xlbls+='<text x="'+pxY(xi).toFixed(1)+'" y="'+(H-5)+'" text-anchor="middle" fill="#9A8A78" font-size="9">'+mShort[xi]+'</text>';
  }
  var legend='<div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:6px;justify-content:center;">';
  d.years.forEach(function(yr,yi){
    var color=palette[yi%palette.length];
    var pts=[];
    for(var mo2=1;mo2<=12;mo2++){
      var ms2=mo2<10?'0'+mo2:''+mo2;
      var row2=(d.monthly[yr]||[]).find(function(r){return r.month===ms2;});
      if(row2&&row2.total) pts.push({x:pxY(mo2-1),y:pyY(row2.total),v:row2.total,mi:mo2-1});
    }
    if(!pts.length) return;
    var pathD=pts.map(function(p,j){return(j?'L ':'M ')+p.x.toFixed(1)+','+p.y.toFixed(1);}).join(' ');
    lines+='<path d="'+pathD+'" fill="none" stroke="'+color+'" stroke-width="2" stroke-linejoin="round"/>';
    pts.forEach(function(p){
      lines+='<circle cx="'+p.x.toFixed(1)+'" cy="'+p.y.toFixed(1)+'" r="3" fill="'+color+'"><title>'+mShort[p.mi]+' '+yr+': '+p.v+'</title></circle>';
    });
    legend+='<span style="display:flex;align-items:center;gap:5px;font-size:.8rem;"><span style="display:inline-block;width:14px;height:14px;background:'+color+';border-radius:3px;flex-shrink:0;"></span>'+yr+'</span>';
  });
  legend+='</div>';
  var svg='<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:'+H+'px;">'+grid+lines+xlbls+ylbls+'</svg>';
  return '<div style="background:var(--white);border:1px solid var(--border);border-radius:12px;padding:16px 16px 8px;margin-bottom:16px;"><div style="font-weight:700;color:var(--steel-anchor);font-size:.9rem;margin-bottom:8px;">Year-over-Year Trend</div>'+svg+legend+'</div>';
}

function renderByServiceChart(d, chartH) {
  var sundays=d.sundays||[];
  if(sundays.length>52) sundays=sundays.slice(sundays.length-52);
  var n=sundays.length;
  if(!n) return '';
  var W=800,H=chartH||180,pL=36,pR=12,pT=12,pB=32,cW=W-pL-pR,cH=H-pT-pB;
  var allV=[];
  sundays.forEach(function(s){if(s.att_8)allV.push(s.att_8);if(s.att_1045)allV.push(s.att_1045);});
  if(!allV.length) return '';
  var maxV=Math.max.apply(null,allV)*1.1;
  var pxS=function(i){return pL+(i/(n>1?n-1:1))*cW;};
  var pyS=function(v){return pT+cH-(v/maxV)*cH;};
  var grid='',ylbls='',xlbls='',line8='',line1045='';
  [0,Math.round(maxV*0.5/1.1),Math.round(maxV/1.1)].forEach(function(v){
    var yy=pyS(v);
    grid+='<line x1="'+pL+'" y1="'+yy.toFixed(1)+'" x2="'+(W-pR)+'" y2="'+yy.toFixed(1)+'" stroke="#f0ece8" stroke-width="1"/>';
    ylbls+='<text x="'+(pL-3)+'" y="'+(yy+3).toFixed(1)+'" text-anchor="end" fill="#9A8A78" font-size="9">'+Math.round(v)+'</text>';
  });
  var stepS=Math.max(1,Math.ceil(n/8));
  for(var si=0;si<n;si+=stepS){
    var sp=sundays[si].service_date.split('-');
    xlbls+='<text x="'+pxS(si).toFixed(1)+'" y="'+(H-5)+'" text-anchor="middle" fill="#9A8A78" font-size="9">'+MONTH_NAMES[parseInt(sp[1])-1]+' '+parseInt(sp[2])+'</text>';
  }
  var pts8=[],pts1045=[];
  sundays.forEach(function(s,i){
    if(s.att_8) pts8.push([pxS(i),pyS(s.att_8),s.att_8,s.service_date]);
    if(s.att_1045) pts1045.push([pxS(i),pyS(s.att_1045),s.att_1045,s.service_date]);
  });
  if(pts8.length){
    line8='<path d="'+pts8.map(function(p,j){return(j?'L ':'M ')+p[0].toFixed(1)+','+p[1].toFixed(1);}).join(' ')+'" fill="none" stroke="#C9973A" stroke-width="2" stroke-linejoin="round"/>';
    pts8.forEach(function(p){line8+='<circle cx="'+p[0].toFixed(1)+'" cy="'+p[1].toFixed(1)+'" r="2.5" fill="#C9973A"><title>'+p[3]+' 8am: '+p[2]+'</title></circle>';});
  }
  if(pts1045.length){
    line1045='<path d="'+pts1045.map(function(p,j){return(j?'L ':'M ')+p[0].toFixed(1)+','+p[1].toFixed(1);}).join(' ')+'" fill="none" stroke="#2E7EA6" stroke-width="2" stroke-linejoin="round"/>';
    pts1045.forEach(function(p){line1045+='<circle cx="'+p[0].toFixed(1)+'" cy="'+p[1].toFixed(1)+'" r="2.5" fill="#2E7EA6"><title>'+p[3]+' 10:45am: '+p[2]+'</title></circle>';});
  }
  var legend='<div style="display:flex;gap:16px;margin-top:6px;justify-content:center;">'
    +'<span style="display:flex;align-items:center;gap:5px;font-size:.8rem;"><span style="display:inline-block;width:24px;height:3px;background:#C9973A;"></span>8am</span>'
    +'<span style="display:flex;align-items:center;gap:5px;font-size:.8rem;"><span style="display:inline-block;width:24px;height:3px;background:#2E7EA6;"></span>10:45am</span>'
    +'</div>';
  var svg='<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:'+H+'px;">'+grid+line8+line1045+xlbls+ylbls+'</svg>';
  return '<div style="background:var(--white);border:1px solid var(--border);border-radius:12px;padding:16px 16px 8px;margin-bottom:16px;"><div style="font-weight:700;color:var(--steel-anchor);font-size:.9rem;margin-bottom:8px;">8am vs 10:45am Trend</div>'+svg+legend+'</div>';
}

function renderAttendanceList(services, totalInDb) {
  var el = document.getElementById('att-list');
  if (!services.length) {
    var dbNote = totalInDb > 0
      ? '<div style="font-size:.8rem;color:var(--warm-gray);margin-top:6px;">&#9432; ' + totalInDb + ' service record(s) exist in the database — try widening the date filter to find them.</div>'
      : '<div style="font-size:.8rem;color:var(--warm-gray);margin-top:6px;">&#9432; No records in the database yet. Run the attendance import from the Import tab first.</div>';
    el.innerHTML = '<div style="padding:32px 24px;text-align:center;background:var(--white);border:1px solid var(--border);border-radius:12px;">'
      + '<div style="font-size:1rem;font-weight:600;color:var(--steel-anchor);margin-bottom:8px;">No services recorded for this period.</div>'
      + '<div style="font-size:.85rem;color:var(--warm-gray);margin-bottom:4px;">Click <strong>+ Add Sunday</strong> to enter attendance manually, or <strong>Pre-fill Year Sundays</strong> to pre-populate the calendar.</div>'
      + dbNote
      + '</div>';
    return;
  }
  var groupBy = (document.getElementById('att-group-by') || {}).value || _attGroupBy || 'none';
  // Group by date
  var byDate = {};
  var dates = [];
  services.forEach(function(s) {
    if (!byDate[s.service_date]) { byDate[s.service_date] = []; dates.push(s.service_date); }
    byDate[s.service_date].push(s);
  });
  var today2 = new Date().toISOString().slice(0,10);
  var html = '';
  var lastMonth = '';
  var MONTH_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  dates.forEach(function(date) {
    // Month group header
    if (groupBy === 'month') {
      var parts2 = date.split('-');
      var monthKey = parts2[0] + '-' + parts2[1];
      if (monthKey !== lastMonth) {
        lastMonth = monthKey;
        html += '<div style="padding:8px 14px 4px;font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--warm-gray);background:var(--linen);border-bottom:1px solid var(--border);">'
          + MONTH_FULL[parseInt(parts2[1])-1] + ' ' + parts2[0] + '</div>';
      }
    }
    var rows = byDate[date];
    var combined = rows.reduce(function(sum, r) { return sum + (r.attendance || 0); }, 0);
    var parts = date.split('-');
    var displayDate = (parts[1]|0) + '/' + (parts[2]|0) + '/' + parts[0];
    var s8 = rows.find(function(r){return r.service_time==='08:00';}) || {};
    var s1045 = rows.find(function(r){return r.service_time==='10:45';}) || {};
    var isSunday = rows.some(function(r){return r.service_type==='sunday';});
    var sundayName = (s8.service_name || s1045.service_name || (rows[0]&&rows[0].service_name) || '');
    var dk = date.replace(/-/g,'_');
    var isFuture = date > today2;
    html += '<div class="att-date-group' + (isFuture ? ' future' : '') + '">';
    html += '<div class="att-date-hdr" onclick="toggleAttEdit(&#39;'+dk+'&#39;)">'
      + '<span style="font-weight:700;color:var(--steel-anchor);min-width:88px;">'+displayDate+'</span>'
      + (sundayName ? '<span style="font-size:.75rem;color:var(--warm-gray);">'+esc(sundayName)+'</span>' : '')
      + '<span style="flex:1;"></span>'
      + (combined ? '<span class="att-combined">&#931; '+combined+'</span>' : '')
      + '<span class="att-edit-hint">&#9998;</span>'
      + '</div>';
    // Read-only summary
    if (isSunday) {
      html += '<div class="att-svc-nums">'
        + '<span><span class="att-svc-lbl">8am</span><span class="att-svc-v">'+(s8.attendance||0)+'</span></span>'
        + '<span><span class="att-svc-lbl">10:45am</span><span class="att-svc-v">'+(s1045.attendance||0)+'</span></span>'
        + '</div>';
    } else {
      html += '<div class="att-svc-nums">' + rows.map(function(s){
        return '<span><span class="att-svc-lbl">'+esc(s.service_name||s.service_time)+'</span><span class="att-svc-v">'+(s.attendance||0)+'</span></span>';
      }).join('') + '</div>';
    }
    // Inline edit form (hidden)
    html += '<div id="att-edit-'+dk+'" class="att-inline-form" style="display:none;">';
    if (isSunday) {
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px;">'
        + '<div><div style="font-size:.72rem;font-weight:700;text-transform:uppercase;color:var(--steel-anchor);margin-bottom:3px;">8am Attendance</div>'
        + '<input type="number" id="ai8-'+dk+'" min="0" value="'+(s8.attendance||0)+'" style="width:100%;padding:7px;border:1px solid var(--border);border-radius:6px;font-size:1rem;font-weight:700;"></div>'
        + '<div><div style="font-size:.72rem;font-weight:700;text-transform:uppercase;color:var(--steel-anchor);margin-bottom:3px;">10:45am Attendance</div>'
        + '<input type="number" id="ai1045-'+dk+'" min="0" value="'+(s1045.attendance||0)+'" style="width:100%;padding:7px;border:1px solid var(--border);border-radius:6px;font-size:1rem;font-weight:700;"></div>'
        + '</div>'
        + '<div style="margin-bottom:10px;"><input type="text" id="ainotes-'+dk+'" value="'+esc(s8.notes||s1045.notes||'')+'" placeholder="Notes…" style="width:100%;padding:6px;border:1px solid var(--border);border-radius:6px;font-size:.85rem;"></div>'
        + '<div style="display:flex;gap:8px;">'
        + '<button class="btn-primary" style="font-size:.82rem;padding:5px 14px;" onclick="saveInlineAttEdit(&#39;'+dk+'&#39;,'+((s8.id)||'null')+','+((s1045.id)||'null')+')">Save</button>'
        + '<button class="btn-secondary" style="font-size:.82rem;padding:5px 14px;" onclick="toggleAttEdit(&#39;'+dk+'&#39;)">Cancel</button>'
        + (s8.id||s1045.id ? '<button class="btn-danger" style="font-size:.82rem;padding:5px 12px;margin-left:auto;" onclick="deleteAttDate(&#39;'+dk+'&#39;,['+[s8.id,s1045.id].filter(Boolean).join(',')+'])">Delete</button>' : '')
        + '</div>';
    } else {
      html += rows.map(function(s){
        return '<div style="margin-bottom:8px;"><div style="font-size:.72rem;font-weight:700;text-transform:uppercase;color:var(--steel-anchor);margin-bottom:3px;">'+esc(s.service_name||s.service_time)+' Attendance</div>'
          + '<input type="number" id="aisingle-'+s.id+'" min="0" value="'+(s.attendance||0)+'" style="width:120px;padding:7px;border:1px solid var(--border);border-radius:6px;font-size:1rem;font-weight:700;"></div>';
      }).join('')
        + '<div style="display:flex;gap:8px;">'
        + '<button class="btn-primary" style="font-size:.82rem;padding:5px 14px;" onclick="saveInlineSingle(['+rows.map(function(s){return s.id;}).join(',')+'],&#39;'+dk+'&#39;)">Save</button>'
        + '<button class="btn-secondary" style="font-size:.82rem;padding:5px 14px;" onclick="toggleAttEdit(&#39;'+dk+'&#39;)">Cancel</button>'
        + '<button class="btn-danger" style="font-size:.82rem;padding:5px 12px;margin-left:auto;" onclick="deleteAttDate(&#39;'+dk+'&#39;,['+rows.map(function(s){return s.id;}).join(',')+'])">Delete</button>'
        + '</div>';
    }
    html += '</div></div>'; // end form + group
  });
  el.innerHTML = '<div class="att-list-card">' + html + '</div>';
}

function toggleAttEdit(dk) {
  var form = document.getElementById('att-edit-'+dk);
  if (!form) return;
  var isOpen = form.style.display !== 'none';
  document.querySelectorAll('.att-inline-form').forEach(function(f){f.style.display='none';});
  if (!isOpen) {
    form.style.display = '';
    form.scrollIntoView({behavior:'smooth', block:'nearest'});
    var inp = form.querySelector('input[type=number]');
    if (inp) { inp.focus(); inp.select(); }
  }
}
function saveInlineAttEdit(dk, id8, id1045) {
  var att8 = parseInt(document.getElementById('ai8-'+dk).value)||0;
  var att1045 = parseInt(document.getElementById('ai1045-'+dk).value)||0;
  var notes = document.getElementById('ainotes-'+dk).value;
  var saves = [];
  if (id8) saves.push(api('/admin/api/attendance/'+id8,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({attendance:att8,notes:notes})}));
  if (id1045) saves.push(api('/admin/api/attendance/'+id1045,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({attendance:att1045,notes:notes})}));
  Promise.all(saves).then(function(){loadAttendance();});
}
function saveInlineSingle(ids, dk) {
  var saves = ids.map(function(id){
    var val = parseInt(document.getElementById('aisingle-'+id).value)||0;
    return api('/admin/api/attendance/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({attendance:val})});
  });
  Promise.all(saves).then(function(){loadAttendance();});
}
function deleteAttDate(dk, ids) {
  if (!confirm('Delete these service records?')) return;
  Promise.all(ids.map(function(id){return api('/admin/api/attendance/'+id,{method:'DELETE'});})).then(function(){loadAttendance();});
}

function seedYearSundays() {
  var year = new Date().getFullYear();
  var yn = prompt('Seed all Sundays for which year?', year);
  if (!yn) return;
  year = parseInt(yn);
  if (isNaN(year)) return;
  api('/admin/api/attendance/seed-year', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({year:year})}).then(function(d) {
    if (d.ok) { alert('Added '+(d.inserted/2)+' Sundays for '+d.year+' ('+(d.skipped/2)+' already existed).'); loadAttendance(); }
  });
}

function openNewSundayEntry() {
  var today = new Date().toISOString().slice(0,10);
  var el = document.getElementById('att-add-form');
  el.style.display = '';
  el.innerHTML = '<div style="font-family:var(--font-head);font-size:1rem;color:var(--steel-anchor);margin-bottom:14px;">Add Sunday Services</div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">'
    + '<div><label style="font-size:.72rem;font-weight:700;text-transform:uppercase;color:var(--warm-gray);">Date</label><input type="date" id="sf-date" value="'+today+'" onchange="fetchSundayName(this.value)" style="width:100%;padding:6px;border:1px solid var(--border);border-radius:6px;"></div>'
    + '<div><label style="font-size:.72rem;font-weight:700;text-transform:uppercase;color:var(--warm-gray);">Sunday Name</label><input type="text" id="sf-name" placeholder="e.g. Second Sunday of Easter" style="width:100%;padding:6px;border:1px solid var(--border);border-radius:6px;"></div>'
    + '</div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">'
    + '<div><label style="font-size:.72rem;font-weight:700;text-transform:uppercase;color:var(--steel-anchor);">8am Attendance</label><input type="number" id="sf-att-8" min="0" placeholder="0" style="width:100%;padding:7px;border:1px solid var(--border);border-radius:6px;font-size:1rem;font-weight:700;"></div>'
    + '<div><label style="font-size:.72rem;font-weight:700;text-transform:uppercase;color:var(--steel-anchor);">10:45am Attendance</label><input type="number" id="sf-att-1045" min="0" placeholder="0" style="width:100%;padding:7px;border:1px solid var(--border);border-radius:6px;font-size:1rem;font-weight:700;"></div>'
    + '</div>'
    + '<div style="margin-bottom:12px;"><label style="font-size:.72rem;font-weight:700;text-transform:uppercase;color:var(--warm-gray);">Notes</label><input type="text" id="sf-notes" placeholder="Optional" style="width:100%;padding:6px;border:1px solid var(--border);border-radius:6px;"></div>'
    + '<div style="display:flex;gap:8px;"><button class="btn-primary" onclick="saveBulkSunday()">Save</button><button class="btn-secondary" onclick="document.getElementById(&#39;att-add-form&#39;).style.display=&#39;none&#39;">Cancel</button></div>';
  fetchSundayName(today);
}


function fetchSundayName(date) {
  if (!date) return;
  api('/admin/api/attendance/sunday-name?date=' + encodeURIComponent(date)).then(function(d) {
    var el = document.getElementById('sf-name');
    if (el && d.name) el.value = d.name;
  });
}

function saveBulkSunday() {
  var date = document.getElementById('sf-date').value;
  var name = document.getElementById('sf-name').value;
  if (!date) { alert('Please enter a date.'); return; }
  api('/admin/api/attendance/bulk-sunday', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      service_date: date, service_name: name,
      att_8: document.getElementById('sf-att-8').value,
      att_1045: document.getElementById('sf-att-1045').value,
      notes: document.getElementById('sf-notes').value
    })
  }).then(function(d) {
    if (d.error) { alert('Error: ' + d.error); return; }
    document.getElementById('att-add-form').style.display = 'none';
    loadAttendance();
  });
}


function _buildAttYoYHtml(d, h) {
  var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var html = '<div id="att-yoy-chart-wrap">'+renderYoYChart(d, h)+'</div>';
  html += _chartResizeHandle('yoyRptResizeStart');
  html += '<div style="font-family:var(--font-head);font-size:1rem;color:var(--steel-anchor);margin-bottom:4px;">Attendance Year-over-Year (Sunday Combined)</div>';
  html += '<div style="font-size:.78rem;color:var(--warm-gray);margin-bottom:12px;">Monthly values show average Sunday attendance for that month.</div>';
  html += '<table class="rpt-table"><thead><tr><th>Month</th>';
  d.years.forEach(function(yr) { html += '<th style="text-align:right;">'+yr+'<br><span style="font-weight:400;font-size:.75rem;">avg/Sun</span></th>'; });
  html += '</tr></thead><tbody>';
  for (var m = 1; m <= 12; m++) {
    var mStr = String(m).padStart(2, '0');
    html += '<tr><td>' + months[m-1] + '</td>';
    d.years.forEach(function(yr) {
      var row = (d.monthly[yr] || []).find(function(r) { return r.month === mStr; });
      var cell = row ? row.total + '<span style="color:var(--warm-gray);font-size:.75rem;"> ('+row.sundays+')</span>' : '—';
      html += '<td style="text-align:right;">' + cell + '</td>';
    });
    html += '</tr>';
  }
  html += '<tr class="rpt-total"><td>Annual Total</td>';
  d.years.forEach(function(yr) { html += '<td style="text-align:right;">' + ((d.totals[yr] || {}).total || 0) + '</td>'; });
  html += '</tr><tr><td style="color:var(--warm-gray);font-size:.82rem;">Sundays recorded</td>';
  d.years.forEach(function(yr) { html += '<td style="text-align:right;color:var(--warm-gray);font-size:.82rem;">' + ((d.totals[yr] || {}).sundays || 0) + '</td>'; });
  html += '</tr></tbody></table><div style="margin-top:8px;"><button class="btn-secondary" style="font-size:.8rem;" onclick="window.print()">Print</button></div>';
  return html;
}
function _buildAttByServiceHtml(d, h) {
  var html = '<div id="att-service-chart-wrap">'+renderByServiceChart(d, h)+'</div>';
  html += _chartResizeHandle('byServiceResizeStart');
  html += '<div style="font-family:var(--font-head);font-size:1rem;color:var(--steel-anchor);margin-bottom:12px;">Attendance by Service Time</div>';
  html += '<table class="rpt-table" style="margin-bottom:16px;"><thead><tr><th>Service</th><th style="text-align:right;">Services</th><th style="text-align:right;">Total</th><th style="text-align:right;">Avg/Service</th></tr></thead><tbody>';
  (d.by_time || []).forEach(function(r) {
    var lbl = r.service_name || (r.service_time === '08:00' ? '8am Service' : r.service_time === '10:45' ? '10:45am Service' : esc(r.service_time));
    html += '<tr><td>' + esc(lbl) + '</td><td style="text-align:right;">' + r.services + '</td><td style="text-align:right;">' + r.total + '</td><td style="text-align:right;">' + r.avg_attendance + '</td></tr>';
  });
  html += '</tbody></table>';
  if (d.sundays && d.sundays.length) {
    html += '<div style="font-weight:700;color:var(--steel-anchor);font-size:.88rem;margin-bottom:8px;">Sunday Combined Totals</div>';
    html += '<table class="rpt-table"><thead><tr><th>Date</th><th style="text-align:right;">8am</th><th style="text-align:right;">10:45am</th><th style="text-align:right;">Combined</th></tr></thead><tbody>';
    d.sundays.forEach(function(r) {
      var parts = r.service_date.split('-');
      html += '<tr><td>' + ((parts[1]|0)+'/'+((parts[2]|0))+'/'+parts[0]) + '</td><td style="text-align:right;">' + (r.att_8 || '—') + '</td><td style="text-align:right;">' + (r.att_1045 || '—') + '</td><td style="text-align:right;font-weight:600;">' + r.combined + '</td></tr>';
    });
    html += '</tbody></table>';
  }
  html += '<div style="margin-top:8px;"><button class="btn-secondary" style="font-size:.8rem;" onclick="window.print()">Print</button></div>';
  return html;
}
function runAttendanceSummary() {
  var years = [];
  document.querySelectorAll('#rpt-att-years input[type=checkbox]:checked').forEach(function(cb) { years.push(cb.value); });
  if (!years.length) { alert('Select at least one year.'); return; }
  api('/admin/api/reports/attendance-summary?years=' + encodeURIComponent(years.join(','))).then(function(d) {
    _lastYoYRptData = d;
    showAttRptOutput(_buildAttYoYHtml(d, _yoyRptH));
  });
}
function setAttByServiceMode(mode) {
  _attSvcMode = mode;
  document.getElementById('att-svc-range-inputs').style.display = mode === 'range' ? '' : 'none';
  document.getElementById('att-svc-years-inputs').style.display = mode === 'years' ? '' : 'none';
  document.getElementById('att-svc-mode-range').classList.toggle('active', mode === 'range');
  document.getElementById('att-svc-mode-years').classList.toggle('active', mode === 'years');
}
function runAttendanceByTime() {
  if (_attSvcMode === 'years') {
    var years = [];
    document.querySelectorAll('#rpt-att-svc-years input[type=checkbox]:checked').forEach(function(cb) { years.push(cb.value); });
    if (!years.length) { alert('Select at least one year.'); return; }
    api('/admin/api/reports/attendance-by-time?years=' + encodeURIComponent(years.join(','))).then(function(d) {
      _lastByServiceRptData = d;
      showAttRptOutput(_buildAttByServiceMultiYearHtml(d, _byServiceRptH));
    });
  } else {
    var from = document.getElementById('rpt-att-from').value;
    var to = document.getElementById('rpt-att-to').value;
    api('/admin/api/reports/attendance-by-time?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to)).then(function(d) {
      _lastByServiceRptData = d;
      showAttRptOutput(_buildAttByServiceHtml(d, _byServiceRptH));
    });
  }
}
function renderMultiYearServiceChart(d, chartH) {
  var years = d.years || [];
  var palette = ['#2E7EA6','#C9973A','#5A9E6F','#9B59B6','#E74C3C'];
  var timesSet = {};
  years.forEach(function(yr) {
    (d.by_time_years[yr] || []).forEach(function(r) {
      if (r.service_type === 'sunday') timesSet[r.service_time] = r.service_name || r.service_time;
    });
  });
  var times = Object.keys(timesSet).sort();
  if (!years.length || !times.length) return '';
  var W = 800, H = chartH || 180, pL = 40, pR = 16, pT = 12, pB = 40;
  var cW = W - pL - pR, cH = H - pT - pB;
  var maxV = 0;
  years.forEach(function(yr) {
    (d.by_time_years[yr] || []).forEach(function(r) {
      if (r.service_type === 'sunday' && r.avg_attendance > maxV) maxV = r.avg_attendance;
    });
  });
  if (!maxV) return '';
  maxV = maxV * 1.15;
  var groupW = cW / times.length;
  var barW = Math.max(4, Math.min(30, (groupW * 0.8) / years.length));
  var groupGap = (groupW - barW * years.length) / 2;
  var pyV = function(v) { return pT + cH - (v / maxV) * cH; };
  var grid = '', ylbls = '', xlbls = '', bars = '';
  [0, Math.round(maxV * 0.5 / 1.15), Math.round(maxV / 1.15)].forEach(function(v) {
    var yy = pyV(v);
    grid += '<line x1="'+pL+'" y1="'+yy.toFixed(1)+'" x2="'+(W-pR)+'" y2="'+yy.toFixed(1)+'" stroke="#f0ece8" stroke-width="1"/>';
    ylbls += '<text x="'+(pL-4)+'" y="'+(yy+3).toFixed(1)+'" text-anchor="end" fill="#9A8A78" font-size="9">'+Math.round(v)+'</text>';
  });
  times.forEach(function(t, ti) {
    var cx = pL + ti * groupW + groupW / 2;
    var lbl = t === '08:00' ? '8am' : t === '10:45' ? '10:45am' : t;
    xlbls += '<text x="'+cx.toFixed(1)+'" y="'+(H-5)+'" text-anchor="middle" fill="#9A8A78" font-size="10">'+lbl+'</text>';
  });
  years.forEach(function(yr, yi) {
    var color = palette[yi % palette.length];
    var byTime = {};
    (d.by_time_years[yr] || []).forEach(function(r) { if (r.service_type === 'sunday') byTime[r.service_time] = r; });
    times.forEach(function(t, ti) {
      var r = byTime[t];
      if (!r) return;
      var tlbl = t === '08:00' ? '8am' : t === '10:45' ? '10:45am' : t;
      var x = pL + ti * groupW + groupGap + yi * barW;
      var bH = Math.max(1, (r.avg_attendance / maxV) * cH);
      var barY = pT + cH - bH;
      bars += '<rect x="'+x.toFixed(1)+'" y="'+barY.toFixed(1)+'" width="'+barW.toFixed(1)+'" height="'+bH.toFixed(1)+'" fill="'+color+'" rx="2"><title>'+yr+' '+tlbl+': avg '+r.avg_attendance+', total '+r.total+', '+r.services+' services</title></rect>';
      if (bH > 14) bars += '<text x="'+(x+barW/2).toFixed(1)+'" y="'+(barY+bH-3).toFixed(1)+'" text-anchor="middle" fill="#fff" font-size="8">'+Math.round(r.avg_attendance)+'</text>';
    });
  });
  var legend = '<div style="display:flex;gap:12px;margin-top:6px;justify-content:center;flex-wrap:wrap;">';
  years.forEach(function(yr, yi) {
    legend += '<span style="display:flex;align-items:center;gap:5px;font-size:.8rem;"><span style="display:inline-block;width:14px;height:14px;background:'+palette[yi % palette.length]+';border-radius:3px;flex-shrink:0;"></span>'+yr+'</span>';
  });
  legend += '</div>';
  var svg = '<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:'+H+'px;">'+grid+bars+xlbls+ylbls+'</svg>';
  return '<div style="background:var(--white);border:1px solid var(--border);border-radius:12px;padding:16px 16px 8px;margin-bottom:16px;"><div style="font-weight:700;color:var(--steel-anchor);font-size:.9rem;margin-bottom:8px;">Avg Attendance by Service Time</div>'+svg+legend+'</div>';
}
function _buildAttByServiceMultiYearHtml(d, h) {
  var years = d.years || [];
  var html = '<div id="att-service-chart-wrap">'+renderMultiYearServiceChart(d, h)+'</div>';
  html += _chartResizeHandle('byServiceResizeStart');
  html += '<div style="font-family:var(--font-head);font-size:1rem;color:var(--steel-anchor);margin-bottom:12px;">Attendance by Service — Multi-Year</div>';
  html += '<table class="rpt-table" style="margin-bottom:16px;"><thead><tr><th>Service</th>';
  years.forEach(function(yr) { html += '<th style="text-align:right;">'+esc(yr)+' Avg</th><th style="text-align:right;">'+esc(yr)+' Total</th>'; });
  html += '</tr></thead><tbody>';
  var timesMap = {};
  years.forEach(function(yr) {
    (d.by_time_years[yr] || []).forEach(function(r) { if (r.service_type === 'sunday') timesMap[r.service_time] = r.service_name || r.service_time; });
  });
  Object.keys(timesMap).sort().forEach(function(t) {
    var lbl = t === '08:00' ? '8am Service' : t === '10:45' ? '10:45am Service' : esc(timesMap[t]);
    html += '<tr><td>'+lbl+'</td>';
    years.forEach(function(yr) {
      var byTime = {};
      (d.by_time_years[yr] || []).forEach(function(r) { byTime[r.service_time] = r; });
      var r = byTime[t];
      html += '<td style="text-align:right;">'+(r ? r.avg_attendance : '—')+'</td><td style="text-align:right;">'+(r ? r.total : '—')+'</td>';
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  html += '<div style="margin-top:8px;"><button class="btn-secondary" style="font-size:.8rem;" onclick="window.print()">Print</button></div>';
  return html;
}

`;
