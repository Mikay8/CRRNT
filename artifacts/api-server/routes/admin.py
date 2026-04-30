"""Admin routes — ingestion controls, config, and a web portal.

All JSON endpoints require the X-Admin-Token header.
The HTML portal at GET /admin/portal?token=<secret> serves a browser UI.
The public POST /push-token endpoint is unauthenticated (device registration).
"""
from __future__ import annotations

import asyncio
import hmac
import logging
import os
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Query, status
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel

from services import config as config_service, ingestion, log_buffer, push

log = logging.getLogger("marktr.admin")

router = APIRouter(tags=["admin"])


# ── Auth ─────────────────────────────────────────────────────────────────────

def _expected_token() -> Optional[str]:
    return os.environ.get("ADMIN_TOKEN") or os.environ.get("SESSION_SECRET")


def _require_admin(token: Optional[str]) -> None:
    expected = _expected_token()
    if not expected:
        log.info("Admin route hit but no ADMIN_TOKEN/SESSION_SECRET configured")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Admin endpoints are disabled (no admin token configured)",
        )
    if not token or not hmac.compare_digest(token, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing X-Admin-Token",
        )


# ── JSON endpoints ────────────────────────────────────────────────────────────

@router.get("/admin/status")
async def status_endpoint(
    x_admin_token: Optional[str] = Header(default=None),
) -> dict:
    _require_admin(x_admin_token)
    return ingestion.get_status()


@router.post("/admin/refresh")
async def refresh(
    x_admin_token: Optional[str] = Header(default=None),
) -> JSONResponse:
    _require_admin(x_admin_token)
    current = ingestion.get_status()
    if current.get("state") == "running":
        return JSONResponse(status_code=409, content=current)
    asyncio.create_task(ingestion.run_ingestion())
    return JSONResponse(status_code=202, content=ingestion.get_status())


@router.get("/admin/stats")
async def stats(
    x_admin_token: Optional[str] = Header(default=None),
) -> dict:
    _require_admin(x_admin_token)
    return ingestion.get_cache_stats()


@router.get("/admin/config")
async def get_config(
    x_admin_token: Optional[str] = Header(default=None),
) -> dict:
    _require_admin(x_admin_token)
    return config_service.get_config()


class ConfigUpdate(BaseModel):
    perCategory: int


@router.post("/admin/config")
async def set_config(
    body: ConfigUpdate,
    x_admin_token: Optional[str] = Header(default=None),
) -> dict:
    _require_admin(x_admin_token)
    updated = config_service.set_config({"perCategory": body.perCategory})
    log.info("Admin: config updated — perCategory=%d", updated["perCategory"])
    return updated


@router.delete("/admin/stories")
async def delete_stories(
    x_admin_token: Optional[str] = Header(default=None),
) -> dict:
    _require_admin(x_admin_token)
    result = ingestion.delete_all_stories()
    return {"deleted": result, "ok": True}


@router.get("/admin/stories")
async def list_stories(
    x_admin_token: Optional[str] = Header(default=None),
) -> dict:
    _require_admin(x_admin_token)
    keys = ingestion.cache.list_keys("article:")
    stories = []
    for key in sorted(keys):
        article_id = key.split(":", 1)[1] if ":" in key else key
        data = ingestion.cache.get(key)
        if data:
            stories.append({
                "articleId": article_id,
                "headline": data.get("headline") or data.get("title") or "",
                "category": data.get("category", ""),
                "date": data.get("date") or data.get("publishedAt", ""),
                "source": data.get("source") or data.get("publisher", ""),
            })
    return {"stories": stories, "total": len(stories)}


@router.delete("/admin/story")
async def delete_story(
    article_id: str = Query(...),
    x_admin_token: Optional[str] = Header(default=None),
) -> dict:
    _require_admin(x_admin_token)
    key = ingestion.article_key(article_id)
    article = ingestion.cache.get(key)
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")
    article_date = (article.get("date") or article.get("publishedAt", ""))[:10]
    if article_date:
        news_batch = ingestion.cache.get(ingestion.news_key(article_date))
        if news_batch and "stories" in news_batch:
            news_batch["stories"] = [
                s for s in news_batch["stories"]
                if str(s.get("articleId", "")) != str(article_id)
            ]
            news_batch["totalCount"] = len(news_batch["stories"])
            ingestion.cache.set(ingestion.news_key(article_date), news_batch)
    ingestion.cache.delete(key)
    log.info("Admin: deleted article %s", article_id)
    return {"ok": True, "articleId": article_id}


@router.get("/admin/stocks")
async def list_stocks(
    x_admin_token: Optional[str] = Header(default=None),
) -> dict:
    _require_admin(x_admin_token)
    keys = ingestion.cache.list_keys("stock:")
    stocks = []
    for key in sorted(keys):
        parts = key.split(":")
        if len(parts) >= 4:
            stocks.append({"key": key, "ticker": parts[1], "range": parts[2], "date": parts[3]})
        else:
            stocks.append({"key": key, "ticker": key, "range": "", "date": ""})
    return {"stocks": stocks, "total": len(stocks)}


@router.delete("/admin/stock")
async def delete_stock(
    key: str = Query(...),
    x_admin_token: Optional[str] = Header(default=None),
) -> dict:
    _require_admin(x_admin_token)
    if not key.startswith("stock:"):
        raise HTTPException(status_code=400, detail="Invalid stock key")
    if ingestion.cache.get(key) is None:
        raise HTTPException(status_code=404, detail="Stock cache not found")
    ingestion.cache.delete(key)
    log.info("Admin: deleted stock cache %s", key)
    return {"ok": True, "key": key}


class SeedPayload(BaseModel):
    date: str
    totalCount: int
    stories: list[dict]


@router.post("/admin/seed")
async def seed_today(
    body: SeedPayload,
    x_admin_token: Optional[str] = Header(default=None),
) -> dict:
    """Write a JSON payload directly into today's KV cache entry."""
    _require_admin(x_admin_token)
    ingestion.cache.set(ingestion.news_key(body.date), body.model_dump())
    for story in body.stories:
        aid = story.get("articleId")
        if aid:
            ingestion.cache.set(ingestion.article_key(str(aid)), story)
    log.info("Admin: seeded %d stories for %s", len(body.stories), body.date)
    return {"ok": True, "storyCount": len(body.stories), "date": body.date}


# ── Public endpoint: device push token registration ───────────────────────────

class PushTokenBody(BaseModel):
    token: str


@router.post("/push-token")
async def register_push_token(body: PushTokenBody) -> dict:
    token = body.token.strip()
    if not token or not token.startswith("ExponentPushToken["):
        raise HTTPException(status_code=422, detail="Invalid Expo push token format")
    push.add_token(token)
    return {"ok": True}


@router.get("/admin/logs")
async def get_api_logs(
    x_admin_token: Optional[str] = Header(default=None),
) -> dict:
    _require_admin(x_admin_token)
    return log_buffer.get_logs()


# ── HTML portal ───────────────────────────────────────────────────────────────

@router.get("/admin/portal", response_class=HTMLResponse)
async def admin_portal(token: str = Query(...)) -> HTMLResponse:
    expected = _expected_token()
    if not expected:
        return HTMLResponse(
            "<h1>503</h1><p>Admin not configured.</p>",
            status_code=503,
        )
    if not hmac.compare_digest(token, expected):
        return HTMLResponse(
            "<h1>401</h1><p>Invalid token.</p>",
            status_code=401,
        )
    return HTMLResponse(content=_PORTAL_HTML)


_PORTAL_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CRRNT Admin</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{
  --bg:#0A0E1A;--surface:#161D2E;--hi:#1F2840;--border:#222B45;
  --text:#F5F7FA;--muted:#9AA3B5;--dim:#6A7388;
  --accent:#00D67E;--pos:#00E89E;--neg:#FF4D6D;--warn:#FFB347;
}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Outfit',-apple-system,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);min-height:100vh}
.header{background:var(--surface);border-bottom:1px solid var(--border);padding:18px 32px;display:flex;align-items:center;gap:12px}
.header h1{font-size:20px;font-weight:700;letter-spacing:-0.5px}
.header p{color:var(--muted);font-size:13px;margin-top:2px}
.main{max-width:820px;margin:0 auto;padding:28px 20px;display:flex;flex-direction:column;gap:20px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:22px}
.card h2{font-size:11px;font-weight:700;color:var(--muted);letter-spacing:1.2px;text-transform:uppercase;margin-bottom:18px}
.row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.col{display:flex;flex-direction:column;gap:8px}
label{font-size:13px;color:var(--muted);font-weight:500}
input[type=range]{accent-color:var(--accent);width:100%;cursor:pointer}
input[type=number]{background:var(--hi);border:1px solid var(--border);border-radius:8px;padding:8px 12px;color:var(--text);font-size:15px;width:76px}
.btn{padding:9px 18px;border-radius:10px;border:none;font-size:14px;font-weight:600;cursor:pointer;transition:opacity .15s}
.btn:hover{opacity:.82}.btn:disabled{opacity:.38;cursor:not-allowed}
.btn-g{background:var(--accent);color:#001A11}
.btn-r{background:var(--neg);color:#fff}
.btn-s{background:var(--hi);color:var(--text);border:1px solid var(--border)}
.badge{padding:4px 10px;border-radius:6px;font-size:12px;font-weight:700}
.b-success{background:#00D67E22;color:var(--pos)}
.b-running{background:#FFB34722;color:var(--warn)}
.b-error{background:#FF4D6D22;color:var(--neg)}
.b-idle{background:#222B45;color:var(--muted)}
.meta{color:var(--muted);font-size:13px}
.divider{height:1px;background:var(--border);margin:16px 0}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px}
.stat{background:var(--hi);border-radius:10px;padding:14px}
.sv{font-size:28px;font-weight:700}
.sl{font-size:12px;color:var(--muted);margin-top:4px}
.danger{border-color:#FF4D6D44}
.toast{position:fixed;bottom:28px;right:28px;background:var(--hi);border:1px solid var(--border);border-radius:12px;padding:13px 18px;font-size:14px;opacity:0;transition:opacity .3s;pointer-events:none;z-index:99}
.toast.show{opacity:1}
.list{display:flex;flex-direction:column;gap:6px;max-height:320px;overflow-y:auto;padding-right:2px}
.list::-webkit-scrollbar{width:4px}
.list::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px}
.item{display:flex;align-items:center;gap:10px;background:var(--hi);border-radius:8px;padding:9px 12px}
.item-info{flex:1;min-width:0}
.item-title{font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.item-meta{font-size:11px;color:var(--muted);margin-top:2px}
.btn-xs{padding:5px 10px;font-size:12px;border-radius:6px}
.empty{color:var(--muted);font-size:13px;padding:18px;text-align:center}
.log-section{border-bottom:1px solid var(--border)}
.log-section:last-child{border-bottom:none}
.log-header{display:flex;align-items:center;gap:8px;padding:11px 4px;cursor:pointer;user-select:none;font-size:14px;font-weight:600}
.log-header:hover{color:var(--accent)}
.log-badge-count{margin-left:auto;font-size:11px;color:var(--muted);background:var(--hi);padding:2px 8px;border-radius:10px;font-weight:500}
.log-chevron{font-size:10px;color:var(--dim);width:12px;text-align:center}
.log-body{padding-bottom:6px}
.log-entry{display:flex;gap:8px;padding:4px 8px;font-size:12px;font-family:'SF Mono',ui-monospace,monospace;border-radius:4px;margin-bottom:1px;line-height:1.5}
.log-ts{color:var(--dim);min-width:62px;flex-shrink:0}
.log-lv{min-width:48px;flex-shrink:0;font-weight:700}
.log-msg{color:var(--text);flex:1;word-break:break-all}
.log-info .log-lv{color:var(--muted)}
.log-warning .log-lv{color:var(--warn)}
.log-error .log-lv,.log-critical .log-lv{color:var(--neg)}
</style>
</head>
<body>
<div class="header">
  <div>
    <h1>&#128274; CRRNT Admin</h1>
    <p>Internal control panel — handle with care</p>
  </div>
</div>
<div class="main">

  <div class="card">
    <h2>Ingestion Status</h2>
    <div class="row" style="margin-bottom:14px">
      <span class="badge b-idle" id="badge">loading</span>
      <span class="meta" id="status-meta"></span>
    </div>
    <div class="divider"></div>
    <div class="row">
      <button class="btn btn-g" id="refresh-btn" onclick="triggerRefresh()">&#9654; Trigger Refresh Now</button>
      <span class="meta" id="refresh-hint"></span>
    </div>
  </div>

  <div class="card">
    <h2>Cache Stats</h2>
    <div class="stats">
      <div class="stat"><div class="sv" id="s-stories">—</div><div class="sl">Stories</div></div>
      <div class="stat"><div class="sv" id="s-batches">—</div><div class="sl">News Batches</div></div>
      <div class="stat"><div class="sv" id="s-stocks">—</div><div class="sl">Stock Caches</div></div>
      <div class="stat"><div class="sv" id="s-tokens">—</div><div class="sl">Push Tokens</div></div>
    </div>
  </div>

  <div class="card">
    <h2>API Logs</h2>
    <div class="row" style="margin-bottom:14px">
      <button class="btn btn-s btn-xs" onclick="loadLogs()">Refresh</button>
      <span style="font-size:11px;color:var(--dim);margin-left:auto" id="logs-updated"></span>
    </div>
    <div id="logs-container"><div class="empty">Loading…</div></div>
  </div>

  <div class="card">
    <h2>Cached Stories</h2>
    <div class="row" style="margin-bottom:14px">
      <span id="story-count" style="font-size:12px;color:var(--muted)">— stories</span>
      <button class="btn btn-s btn-xs" onclick="loadStories()" style="margin-left:auto">Refresh</button>
    </div>
    <div class="list" id="story-list"><div class="empty">Loading…</div></div>
  </div>

  <div class="card">
    <h2>Stock Cache</h2>
    <div class="row" style="margin-bottom:14px">
      <span id="stock-count" style="font-size:12px;color:var(--muted)">— entries</span>
      <button class="btn btn-s btn-xs" onclick="loadStockCaches()" style="margin-left:auto">Refresh</button>
    </div>
    <div class="list" id="stock-list"><div class="empty">Loading…</div></div>
  </div>

  <div class="card">
    <h2>Configuration</h2>
    <div class="col">
      <label>Stories fetched per category (1 – 25)</label>
      <div class="row">
        <input type="range" min="1" max="25" value="10" id="slider"
          oninput="document.getElementById('num').value=this.value" style="flex:1">
        <input type="number" min="1" max="25" value="10" id="num"
          oninput="document.getElementById('slider').value=this.value">
      </div>
    </div>
    <div style="margin-top:16px">
      <button class="btn btn-g" onclick="saveConfig()">Save Configuration</button>
    </div>
  </div>

  <div class="card danger">
    <h2>&#9888; Danger Zone</h2>
    <p class="meta" style="margin-bottom:16px">Deleted stories cannot be recovered. Config and push tokens are preserved.</p>
    <button class="btn btn-r" onclick="deleteStories()">Delete All Cached Stories</button>
  </div>

</div>
<div class="toast" id="toast"></div>
<script>
const T=new URLSearchParams(location.search).get('token')||'';
const H={'Content-Type':'application/json','X-Admin-Token':T};

function toast(msg,ok=true){
  const el=document.getElementById('toast');
  el.textContent=msg;
  el.style.borderColor=ok?'var(--border)':'#FF4D6D66';
  el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'),3200);
}

async function loadStatus(){
  try{
    const r=await fetch('/api/admin/status',{headers:H});
    const d=await r.json();
    const b=document.getElementById('badge');
    b.textContent=d.state;
    b.className='badge b-'+d.state;
    const parts=[];
    if(d.storyCount)parts.push(d.storyCount+' stories');
    if(d.perCategory)parts.push(d.perCategory+' per category');
    if(d.finishedAt)parts.push('Finished '+new Date(d.finishedAt).toLocaleString());
    if(d.message)parts.push('Error: '+d.message);
    document.getElementById('status-meta').textContent=parts.join(' · ');
  }catch(e){}
}

async function loadStats(){
  try{
    const r=await fetch('/api/admin/stats',{headers:H});
    const d=await r.json();
    document.getElementById('s-stories').textContent=d.stories??'—';
    document.getElementById('s-batches').textContent=d.newsBatches??'—';
    document.getElementById('s-stocks').textContent=d.stocks??'—';
    document.getElementById('s-tokens').textContent=d.pushTokens??'—';
  }catch(e){}
}

async function loadConfig(){
  try{
    const r=await fetch('/api/admin/config',{headers:H});
    const d=await r.json();
    document.getElementById('slider').value=d.perCategory;
    document.getElementById('num').value=d.perCategory;
  }catch(e){}
}

async function triggerRefresh(){
  const btn=document.getElementById('refresh-btn');
  btn.disabled=true;btn.textContent='Starting…';
  try{
    const r=await fetch('/api/admin/refresh',{method:'POST',headers:H});
    if(r.status===202)toast('Ingestion started! Takes a few minutes.');
    else if(r.status===409)toast('Already running — check status above.',false);
    else toast('Error: '+r.status,false);
  }catch(e){toast('Request failed',false);}
  setTimeout(()=>{btn.disabled=false;btn.textContent='▶ Trigger Refresh Now';loadStatus();loadStats();},2500);
}

async function saveConfig(){
  const n=parseInt(document.getElementById('num').value)||10;
  const val=Math.max(1,Math.min(25,n));
  try{
    const r=await fetch('/api/admin/config',{method:'POST',headers:H,body:JSON.stringify({perCategory:val})});
    if(r.ok)toast('Configuration saved!');
    else toast('Failed to save: '+r.status,false);
  }catch(e){toast('Request failed',false);}
}

async function deleteStories(){
  if(!confirm('Delete ALL cached stories? This cannot be undone.'))return;
  try{
    const r=await fetch('/api/admin/stories',{method:'DELETE',headers:H});
    const d=await r.json();
    if(r.ok){toast('Deleted '+d.deleted.articles+' stories.');loadStats();loadStories();}
    else toast('Failed: '+r.status,false);
  }catch(e){toast('Request failed',false);}
}

function esc(s){const d=document.createElement('div');d.textContent=String(s||'');return d.innerHTML;}

async function loadStories(){
  const el=document.getElementById('story-list');
  el.innerHTML='<div class="empty">Loading…</div>';
  try{
    const r=await fetch('/api/admin/stories',{headers:H});
    const d=await r.json();
    document.getElementById('story-count').textContent=d.total+' stories';
    if(!d.stories.length){el.innerHTML='<div class="empty">No stories cached.</div>';return;}
    el.innerHTML=d.stories.map(s=>`<div class="item">
      <div class="item-info">
        <div class="item-title">${esc(s.headline||'(no headline)')}</div>
        <div class="item-meta">${[s.category,s.date,s.articleId].filter(Boolean).map(esc).join(' · ')}</div>
      </div>
      <button class="btn btn-r btn-xs" data-id="${esc(s.articleId)}" onclick="deleteStory(this.dataset.id)">Delete</button>
    </div>`).join('');
  }catch(e){el.innerHTML='<div class="empty">Failed to load.</div>';}
}

async function deleteStory(articleId){
  if(!confirm('Delete story "'+articleId+'"?'))return;
  try{
    const r=await fetch('/api/admin/story?article_id='+encodeURIComponent(articleId),{method:'DELETE',headers:H});
    if(r.ok){toast('Story deleted.');loadStories();loadStats();}
    else{const d=await r.json().catch(()=>({}));toast('Failed: '+(d.detail||r.status),false);}
  }catch(e){toast('Request failed',false);}
}

const LOG_SOURCES={
  'marktr.xapi':       'X / Twitter',
  'marktr.newsmesh':   'News (NewsMesh)',
  'marktr.stock':      'Stock API',
  'marktr.enrichment': 'AI Enrichment',
  'marktr.fish_audio': 'Fish Audio',
  'marktr.push':       'Push Notifications',
  'marktr.ingestion':  'Ingestion',
  'marktr.scheduler':  'Scheduler',
  'marktr.cache':      'Cache',
  'marktr.admin':      'Admin',
};

function toggleLog(key){
  const body=document.getElementById('lb-'+key);
  const chev=document.getElementById('lc-'+key);
  const open=body.style.display!=='none';
  body.style.display=open?'none':'block';
  chev.textContent=open?'▶':'▼';
}

async function loadLogs(){
  try{
    const r=await fetch('/api/admin/logs',{headers:H});
    const d=await r.json();
    const container=document.getElementById('logs-container');
    container.innerHTML=Object.entries(LOG_SOURCES).map(([key,label])=>{
      const logs=d[key]||[];
      const entries=logs.length===0
        ?'<div class="empty" style="padding:10px 8px">No recent logs.</div>'
        :logs.map(l=>`<div class="log-entry log-${l.level.toLowerCase()}"><span class="log-ts">${esc(l.ts)}</span><span class="log-lv">${esc(l.level)}</span><span class="log-msg">${esc(l.msg)}</span></div>`).join('');
      return `<div class="log-section">
        <div class="log-header" onclick="toggleLog('${key}')">
          <span>${esc(label)}</span>
          <span class="log-badge-count">${logs.length}</span>
          <span class="log-chevron" id="lc-${key}">▶</span>
        </div>
        <div class="log-body" id="lb-${key}" style="display:none">
          <div class="list" style="max-height:220px">${entries}</div>
        </div>
      </div>`;
    }).join('');
    document.getElementById('logs-updated').textContent='Updated '+new Date().toLocaleTimeString();
  }catch(e){}
}

async function loadStockCaches(){
  const el=document.getElementById('stock-list');
  el.innerHTML='<div class="empty">Loading…</div>';
  try{
    const r=await fetch('/api/admin/stocks',{headers:H});
    const d=await r.json();
    document.getElementById('stock-count').textContent=d.total+' entries';
    if(!d.stocks.length){el.innerHTML='<div class="empty">No stock cache entries.</div>';return;}
    el.innerHTML=d.stocks.map(s=>`<div class="item">
      <div class="item-info">
        <div class="item-title">${esc(s.ticker)}</div>
        <div class="item-meta">${esc(s.range)} · ${esc(s.date)}</div>
      </div>
      <button class="btn btn-r btn-xs" data-key="${esc(s.key)}" onclick="deleteStock(this.dataset.key)">Delete</button>
    </div>`).join('');
  }catch(e){el.innerHTML='<div class="empty">Failed to load.</div>';}
}

async function deleteStock(key){
  if(!confirm('Delete stock cache: '+key+'?'))return;
  try{
    const r=await fetch('/api/admin/stock?key='+encodeURIComponent(key),{method:'DELETE',headers:H});
    if(r.ok){toast('Stock cache deleted.');loadStockCaches();loadStats();}
    else{const d=await r.json().catch(()=>({}));toast('Failed: '+(d.detail||r.status),false);}
  }catch(e){toast('Request failed',false);}
}

loadStatus();loadStats();loadConfig();loadStories();loadStockCaches();loadLogs();
setInterval(loadStatus,10000);
setInterval(loadStats,30000);
setInterval(loadLogs,15000);
</script>
</body>
</html>"""
