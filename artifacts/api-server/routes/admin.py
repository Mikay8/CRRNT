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

from services import config as config_service, ingestion, push

log = logging.getLogger("marktr.admin")

router = APIRouter(tags=["admin"])


# ── Auth ─────────────────────────────────────────────────────────────────────

def _expected_token() -> Optional[str]:
    return os.environ.get("ADMIN_TOKEN") or os.environ.get("SESSION_SECRET")


def _require_admin(token: Optional[str]) -> None:
    expected = _expected_token()
    if not expected:
        log.error("Admin route hit but no ADMIN_TOKEN/SESSION_SECRET configured")
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
<title>Marktr Admin</title>
<style>
:root{
  --bg:#0A0E1A;--surface:#161D2E;--hi:#1F2840;--border:#222B45;
  --text:#F5F7FA;--muted:#9AA3B5;--dim:#6A7388;
  --accent:#00D67E;--pos:#00E89E;--neg:#FF4D6D;--warn:#FFB347;
}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);min-height:100vh}
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
</style>
</head>
<body>
<div class="header">
  <div>
    <h1>&#128274; Marktr Admin</h1>
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
    if(r.ok){toast('Deleted '+d.deleted.articles+' stories.');loadStats();}
    else toast('Failed: '+r.status,false);
  }catch(e){toast('Request failed',false);}
}

loadStatus();loadStats();loadConfig();
setInterval(loadStatus,10000);
setInterval(loadStats,30000);
</script>
</body>
</html>"""
