// ============================================================
//  dashboard.js — Dashboard web sécurisé (Discord OAuth2 + whitelist)
//
//  Intégration dans index.js :
//    const dashboard = require('./modules/dashboard');
//    dashboard.initDashboard({ app, client, db, guildId: '975054589407674430' });
//
//  Variables d'environnement (sur Render) :
//    DISCORD_CLIENT_SECRET  = le Client Secret de l'app Discord
//    DASHBOARD_WHITELIST    = IDs Discord autorisés, séparés par virgule
//    SESSION_SECRET         = phrase aléatoire pour signer les sessions
//    BASE_URL               = https://candidature-bot-5ih5.onrender.com (optionnel)
//
//  Redirect à ajouter dans Discord Developer Portal > OAuth2 > Redirects :
//    https://candidature-bot-5ih5.onrender.com/dashboard/callback
// ============================================================

const crypto = require('crypto');
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');

const CLIENT_ID = '1485359905639764070';
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
const WHITELIST = (process.env.DASHBOARD_WHITELIST || '905540994144030800').split(',').map(s => s.trim());
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-moi-session-secret';
const BASE_URL = process.env.BASE_URL || 'https://candidature-bot-5ih5.onrender.com';
const REDIRECT_URI = `${BASE_URL}/dashboard/callback`;

let client = null;
let db = null;
let GUILD_ID = null;

// ---- Sessions signées (cookie HMAC, sans librairie externe) ----
function signSession(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}
function verifySession(token) {
  if (!token) return null;
  const [data, sig] = token.split('.');
  if (!data || !sig) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch (e) { return null; }
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach(c => {
    const [k, ...v] = c.trim().split('=');
    if (k) out[k] = decodeURIComponent(v.join('='));
  });
  return out;
}

// ---- Middleware d'authentification ----
function requireAuth(req, res, next) {
  const cookies = parseCookies(req);
  const session = verifySession(cookies.dash_session);
  if (!session || !WHITELIST.includes(session.id)) {
    if (req.path.startsWith('/dashboard/api/')) {
      return res.status(401).json({ error: 'non autorisé' });
    }
    return res.redirect('/dashboard/login');
  }
  req.dashUser = session;
  next();
}

function initDashboard({ app, client: c, db: database, guildId }) {
  client = c;
  db = database;
  GUILD_ID = guildId;

  // ===== PAGE DE LOGIN =====
  app.get('/dashboard/login', (req, res) => {
    const url = `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify`;
    res.send(loginPage(url));
  });

  // ===== DÉBUT OAUTH2 =====
  app.get('/dashboard/auth', (req, res) => {
    const url = `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify`;
    res.redirect(url);
  });

  // ===== CALLBACK OAUTH2 =====
  app.get('/dashboard/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.redirect('/dashboard/login');
    try {
      // Échange code -> token
      const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          grant_type: 'authorization_code',
          code,
          redirect_uri: REDIRECT_URI
        })
      });
      const tokenData = await tokenRes.json();
      if (!tokenData.access_token) {
        console.error('OAuth2 échec token:', tokenData);
        return res.send(errorPage('Échec de la connexion Discord.'));
      }

      // Récupérer l'identité
      const userRes = await fetch('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      const user = await userRes.json();

      if (!WHITELIST.includes(user.id)) {
        return res.send(errorPage(`Accès refusé. Ton compte (${user.username}) n'est pas autorisé.`));
      }

      // Créer la session (7 jours)
      const token = signSession({ id: user.id, username: user.username, avatar: user.avatar, exp: Date.now() + 7 * 24 * 3600 * 1000 });
      res.setHeader('Set-Cookie', `dash_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${7 * 24 * 3600}`);
      res.redirect('/dashboard');
    } catch (e) {
      console.error('Erreur callback OAuth2:', e);
      res.send(errorPage('Erreur serveur pendant la connexion.'));
    }
  });

  // ===== DÉCONNEXION =====
  app.get('/dashboard/logout', (req, res) => {
    res.setHeader('Set-Cookie', 'dash_session=; HttpOnly; Path=/; Max-Age=0');
    res.redirect('/dashboard/login');
  });

  // ===== PAGE PRINCIPALE (protégée) =====
  app.get('/dashboard', requireAuth, (req, res) => {
    res.send(dashboardPage(req.dashUser));
  });

  // ===== API : infos serveur =====
  app.get('/dashboard/api/me', requireAuth, (req, res) => {
    res.json({ user: req.dashUser });
  });

  // ===== API : liste des salons =====
  app.get('/dashboard/api/channels', requireAuth, async (req, res) => {
    try {
      const guild = await client.guilds.fetch(GUILD_ID);
      const channels = await guild.channels.fetch();
      const list = channels
        .filter(c => c && c.type === 0) // texte
        .map(c => ({ id: c.id, name: c.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
      res.json({ channels: list });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ===== API : liste des membres =====
  app.get('/dashboard/api/members', requireAuth, async (req, res) => {
    try {
      const guild = await client.guilds.fetch(GUILD_ID);
      const members = await guild.members.fetch();
      const list = members.map(m => ({
        id: m.user.id,
        username: m.user.username,
        displayName: m.displayName,
        avatar: m.user.displayAvatarURL({ size: 64 }),
        bot: m.user.bot,
        roles: m.roles.cache.filter(r => r.name !== '@everyone').map(r => r.name)
      }));
      res.json({ members: list, count: list.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ===== API : envoyer un message =====
  app.post('/dashboard/api/send', requireAuth, async (req, res) => {
    const { channelId, message, embed } = req.body;
    if (!channelId) return res.status(400).json({ error: 'salon manquant' });
    try {
      const channel = await client.channels.fetch(channelId);
      if (embed && embed.title) {
        const e = new EmbedBuilder().setColor(embed.color ? parseInt(embed.color.replace('#', ''), 16) : 0x5865F2);
        if (embed.title) e.setTitle(embed.title);
        if (embed.description) e.setDescription(embed.description.replace(/\\n/g, '\n'));
        if (embed.image) e.setImage(embed.image);
        if (embed.footer) e.setFooter({ text: embed.footer });
        await channel.send({ embeds: [e] });
      } else {
        if (!message) return res.status(400).json({ error: 'message vide' });
        await channel.send(message.replace(/\\n/g, '\n'));
      }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ===== API : rôles-réactions (liste) =====
  app.get('/dashboard/api/rolereactions', requireAuth, async (req, res) => {
    try {
      const list = await db.collection('role_reactions').find({ guildId: GUILD_ID }).toArray();
      res.json({ bindings: list });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ===== API : config des tickets (lecture) =====
  app.get('/dashboard/api/tickets/config', requireAuth, async (req, res) => {
    try {
      const cfg = await db.collection('config').findOne({ _id: 'tickets' });
      res.json({ config: cfg || {} });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ===== API : config des tickets (sauvegarde) =====
  app.post('/dashboard/api/tickets/config', requireAuth, async (req, res) => {
    try {
      const allowed = ['enabled', 'categoryId', 'transcriptChannelId', 'staffRoleIds', 'panelTitle', 'panelDescription', 'panelColor', 'welcomeMessage', 'categories'];
      const update = {};
      for (const k of allowed) if (req.body[k] !== undefined) update[k] = req.body[k];
      await db.collection('config').updateOne({ _id: 'tickets' }, { $set: update }, { upsert: true });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ===== API : liste des rôles du serveur =====
  app.get('/dashboard/api/roles', requireAuth, async (req, res) => {
    try {
      const guild = await client.guilds.fetch(GUILD_ID);
      const roles = await guild.roles.fetch();
      const list = roles
        .filter(r => r.name !== '@everyone')
        .map(r => ({ id: r.id, name: r.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
      res.json({ roles: list });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ===== API : liste des catégories (salons parent) =====
  app.get('/dashboard/api/categories', requireAuth, async (req, res) => {
    try {
      const guild = await client.guilds.fetch(GUILD_ID);
      const channels = await guild.channels.fetch();
      const list = channels
        .filter(c => c && c.type === 4) // catégorie
        .map(c => ({ id: c.id, name: c.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
      res.json({ categories: list });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  console.log('[Dashboard] Prêt sur', `${BASE_URL}/dashboard`);
}

// ============================================================
//  PAGES HTML
// ============================================================
function loginPage(oauthUrl) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MultiBOT — Connexion</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;font-family:'Segoe UI',sans-serif}
body{background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;height:100vh;display:flex;align-items:center;justify-content:center}
.box{background:#16213e;padding:48px;border-radius:20px;border:2px solid #FFD700;text-align:center;max-width:400px}
.box h1{color:#FFD700;margin-bottom:12px;font-size:28px}
.box p{color:#aaa;margin-bottom:28px}
.btn{display:inline-flex;align-items:center;gap:10px;background:#5865F2;color:#fff;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:bold;transition:.2s}
.btn:hover{background:#4752c4}
</style></head><body>
<div class="box">
<h1>🐺 MultiBOT</h1>
<p>Dashboard d'administration</p>
<a class="btn" href="${oauthUrl}">Se connecter avec Discord</a>
</div></body></html>`;
}

function errorPage(msg) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Accès refusé</title>
<style>*{margin:0;padding:0;box-sizing:border-box;font-family:'Segoe UI',sans-serif}
body{background:#1a1a2e;color:#fff;height:100vh;display:flex;align-items:center;justify-content:center;text-align:center}
.box{background:#16213e;padding:48px;border-radius:20px;border:2px solid #f44336;max-width:420px}
.box h1{color:#f44336;margin-bottom:16px}.box p{color:#ccc;margin-bottom:24px}
a{color:#FFD700}</style></head><body>
<div class="box"><h1>⛔ Accès refusé</h1><p>${msg}</p><a href="/dashboard/login">Réessayer</a></div>
</body></html>`;
}

function dashboardPage(user) {
  const avatar = user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png';
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MultiBOT — Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;font-family:'Segoe UI',sans-serif}
body{background:#1a1a2e;color:#f0f0f0;display:flex;min-height:100vh}
.sidebar{width:230px;background:#16213e;border-right:1px solid #0f3460;position:fixed;height:100vh;display:flex;flex-direction:column}
.sidebar h2{color:#FFD700;padding:22px;text-align:center;border-bottom:1px solid #0f3460}
.nav{padding:12px 0;flex:1}
.nav a{display:block;padding:13px 22px;color:#aaa;text-decoration:none;cursor:pointer;border-left:3px solid transparent}
.nav a:hover,.nav a.active{background:#0f3460;color:#FFD700;border-left-color:#FFD700}
.userbar{padding:16px;border-top:1px solid #0f3460;display:flex;align-items:center;gap:10px}
.userbar img{width:36px;height:36px;border-radius:50%}
.userbar .u{font-size:13px}.userbar .u b{display:block}
.userbar a{color:#f44336;font-size:12px;text-decoration:none}
.main{margin-left:230px;padding:32px;width:calc(100% - 230px)}
.page{display:none}.page.active{display:block}
h1.title{color:#FFD700;margin-bottom:24px;border-left:4px solid #FFD700;padding-left:12px}
.card{background:#16213e;border:1px solid #0f3460;border-radius:12px;padding:20px;margin-bottom:16px}
label{display:block;font-size:12px;color:#aaa;text-transform:uppercase;margin-bottom:6px;font-weight:bold}
input,textarea,select{width:100%;padding:11px;background:#0f3460;border:1px solid #1a4a7a;color:#fff;border-radius:8px;margin-bottom:14px;font-size:14px}
textarea{height:100px;resize:vertical}
.btn{background:#FFD700;color:#1a1a2e;border:none;padding:11px 22px;border-radius:8px;font-weight:bold;cursor:pointer;font-size:14px}
.btn:hover{background:#e6c200}
.toggle{display:flex;align-items:center;gap:8px;margin-bottom:14px}
.toggle input{width:auto;margin:0}
.fb{padding:10px;border-radius:8px;margin-top:10px;display:none}
.fb.ok{background:#1e4d2b;color:#4CAF50;display:block}.fb.err{background:#4d1e1e;color:#ef9a9a;display:block}
.member{display:flex;align-items:center;gap:10px;padding:8px;border-bottom:1px solid #0f3460}
.member img{width:32px;height:32px;border-radius:50%}
.badge{background:#0f3460;padding:2px 8px;border-radius:10px;font-size:11px;margin-left:4px}
.soon{color:#888;font-style:italic;padding:20px;text-align:center}
</style></head><body>
<div class="sidebar">
<h2>🐺 MultiBOT</h2>
<div class="nav">
<a class="active" onclick="show('messages',this)">📨 Messages</a>
<a onclick="show('embed',this)">🎨 Embeds</a>
<a onclick="show('roles',this)">🎭 Rôles-réactions</a>
<a onclick="show('membres',this)">👥 Membres</a>
<a onclick="show('tickets',this)">🎫 Tickets</a>
<a onclick="show('config',this)">⚙️ Configuration</a>
</div>
<div class="userbar">
<img src="${avatar}">
<div class="u"><b>${user.username}</b><a href="/dashboard/logout">Déconnexion</a></div>
</div>
</div>
<div class="main">

<div id="p-messages" class="page active">
<h1 class="title">📨 Envoyer un message</h1>
<div class="card">
<label>Salon</label><select id="msgChannel"><option>Chargement…</option></select>
<label>Message</label><textarea id="msgText" placeholder="Ton message… (\\n pour saut de ligne)"></textarea>
<button class="btn" onclick="sendMsg()">Envoyer</button>
<div class="fb" id="msgFb"></div>
</div>
</div>

<div id="p-embed" class="page">
<h1 class="title">🎨 Envoyer un embed</h1>
<div class="card">
<label>Salon</label><select id="embChannel"><option>Chargement…</option></select>
<label>Titre</label><input id="embTitle" placeholder="Titre de l'embed">
<label>Description</label><textarea id="embDesc" placeholder="Texte… (\\n pour saut de ligne)"></textarea>
<label>Couleur (hex)</label><input id="embColor" placeholder="#FFD700" value="#5865F2">
<label>Image (URL, optionnel)</label><input id="embImage" placeholder="https://…">
<label>Footer (optionnel)</label><input id="embFooter" placeholder="Texte du pied de page">
<button class="btn" onclick="sendEmbed()">Envoyer l'embed</button>
<div class="fb" id="embFb"></div>
</div>
</div>

<div id="p-roles" class="page">
<h1 class="title">🎭 Rôles-réactions</h1>
<div class="card">
<p style="color:#aaa;margin-bottom:12px">Liaisons actuelles (à créer via la commande <b>/rolereaction ajouter</b> sur Discord) :</p>
<div id="rolesList">Chargement…</div>
</div>
</div>

<div id="p-membres" class="page">
<h1 class="title">👥 Membres</h1>
<div class="card">
<input id="memberSearch" placeholder="Rechercher…" oninput="filterMembers()">
<div id="membersList">Chargement…</div>
</div>
</div>

<div id="p-config" class="page">
<h1 class="title">⚙️ Configuration</h1>
<div class="card"><div class="soon">🚧 Les systèmes niveaux, logs et auto-modération seront configurables ici prochainement.</div></div>
</div>

<div id="p-tickets" class="page">
<h1 class="title">🎫 Configuration des tickets</h1>
<div class="card">
<div class="toggle"><input type="checkbox" id="tkEnabled"><label style="margin:0">Système de tickets activé</label></div>
<label>Catégorie Discord où créer les tickets</label><select id="tkCategory"></select>
<label>Salon d'archives des transcripts</label><select id="tkTranscript"></select>
<label>Rôles staff (Ctrl+clic pour plusieurs)</label><select id="tkStaff" multiple style="height:120px"></select>
</div>
<div class="card">
<label>Titre du panneau</label><input id="tkTitle">
<label>Description du panneau</label><textarea id="tkDesc"></textarea>
<label>Couleur (hex)</label><input id="tkColor" value="#5865F2">
<label>Message d'accueil du ticket ({user} = mention)</label><textarea id="tkWelcome"></textarea>
</div>
<div class="card">
<label>Catégories de tickets (une par ligne : emoji | label | description)</label>
<textarea id="tkCats" style="height:140px" placeholder="🛠️ | Support | Besoin d'aide"></textarea>
<small style="color:#888">Format : emoji | label | description</small>
</div>
<button class="btn" onclick="saveTickets()">💾 Sauvegarder</button>
<div class="fb" id="tkFb"></div>
<div class="card" style="margin-top:16px"><small style="color:#888">Après avoir configuré, va dans le salon voulu sur Discord et tape <b>/panel</b> pour poster le menu de tickets.</small></div>
</div>

</div>
<script>
let allMembers=[];
function show(id,el){document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));document.querySelectorAll('.nav a').forEach(a=>a.classList.remove('active'));document.getElementById('p-'+id).classList.add('active');el.classList.add('active');
if(id==='membres')loadMembers();if(id==='roles')loadRoles();if(id==='tickets')loadTickets();}
async function loadChannels(){const r=await fetch('/dashboard/api/channels');const d=await r.json();const opts=(d.channels||[]).map(c=>'<option value="'+c.id+'">#'+c.name+'</option>').join('');document.getElementById('msgChannel').innerHTML=opts;document.getElementById('embChannel').innerHTML=opts;}
async function sendMsg(){const fb=document.getElementById('msgFb');const r=await fetch('/dashboard/api/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({channelId:document.getElementById('msgChannel').value,message:document.getElementById('msgText').value})});const d=await r.json();if(d.ok){fb.className='fb ok';fb.textContent='✅ Message envoyé !';document.getElementById('msgText').value='';}else{fb.className='fb err';fb.textContent='❌ '+(d.error||'Erreur');}}
async function sendEmbed(){const fb=document.getElementById('embFb');const r=await fetch('/dashboard/api/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({channelId:document.getElementById('embChannel').value,embed:{title:document.getElementById('embTitle').value,description:document.getElementById('embDesc').value,color:document.getElementById('embColor').value,image:document.getElementById('embImage').value,footer:document.getElementById('embFooter').value}})});const d=await r.json();if(d.ok){fb.className='fb ok';fb.textContent='✅ Embed envoyé !';}else{fb.className='fb err';fb.textContent='❌ '+(d.error||'Erreur');}}
async function loadMembers(){const r=await fetch('/dashboard/api/members');const d=await r.json();allMembers=d.members||[];renderMembers(allMembers);}
function renderMembers(list){document.getElementById('membersList').innerHTML=list.map(m=>'<div class="member"><img src="'+m.avatar+'"><div><b>'+m.displayName+'</b>'+(m.bot?'<span class="badge">BOT</span>':'')+'<br><small style="color:#888">'+m.id+'</small></div></div>').join('')||'<p style="color:#888">Aucun membre</p>';}
function filterMembers(){const q=document.getElementById('memberSearch').value.toLowerCase();renderMembers(allMembers.filter(m=>m.displayName.toLowerCase().includes(q)||m.username.toLowerCase().includes(q)||m.id.includes(q)));}
async function loadRoles(){const r=await fetch('/dashboard/api/rolereactions');const d=await r.json();const list=d.bindings||[];document.getElementById('rolesList').innerHTML=list.length?list.map(b=>'<div class="member">'+(b.emojiRaw||b.emoji)+' → <b>'+b.roleId+'</b> <small style="color:#888">(msg '+b.messageId+')</small></div>').join(''):'<p style="color:#888">Aucune liaison configurée.</p>';}
async function loadTickets(){
const [cfgR,catR,chR,roleR]=await Promise.all([fetch('/dashboard/api/tickets/config'),fetch('/dashboard/api/categories'),fetch('/dashboard/api/channels'),fetch('/dashboard/api/roles')]);
const cfg=(await cfgR.json()).config||{};const cats=(await catR.json()).categories||[];const chans=(await chR.json()).channels||[];const roles=(await roleR.json()).roles||[];
document.getElementById('tkCategory').innerHTML='<option value="">— Aucune —</option>'+cats.map(c=>'<option value="'+c.id+'"'+(cfg.categoryId===c.id?' selected':'')+'>'+c.name+'</option>').join('');
document.getElementById('tkTranscript').innerHTML='<option value="">— Aucun —</option>'+chans.map(c=>'<option value="'+c.id+'"'+(cfg.transcriptChannelId===c.id?' selected':'')+'>#'+c.name+'</option>').join('');
document.getElementById('tkStaff').innerHTML=roles.map(r=>'<option value="'+r.id+'"'+((cfg.staffRoleIds||[]).includes(r.id)?' selected':'')+'>'+r.name+'</option>').join('');
document.getElementById('tkEnabled').checked=cfg.enabled!==false;
document.getElementById('tkTitle').value=cfg.panelTitle||'';
document.getElementById('tkDesc').value=cfg.panelDescription||'';
document.getElementById('tkColor').value=cfg.panelColor||'#5865F2';
document.getElementById('tkWelcome').value=cfg.welcomeMessage||'';
document.getElementById('tkCats').value=(cfg.categories||[]).map(c=>(c.emoji||'')+' | '+c.label+' | '+(c.description||'')).join('\n');
}
async function saveTickets(){
const fb=document.getElementById('tkFb');
const staff=Array.from(document.getElementById('tkStaff').selectedOptions).map(o=>o.value);
const cats=document.getElementById('tkCats').value.split('\n').filter(l=>l.trim()).map((l,i)=>{const p=l.split('|').map(x=>x.trim());return{id:'cat'+i,emoji:p[0]||'',label:p[1]||p[0]||'Catégorie',description:p[2]||''};});
const body={enabled:document.getElementById('tkEnabled').checked,categoryId:document.getElementById('tkCategory').value||null,transcriptChannelId:document.getElementById('tkTranscript').value||null,staffRoleIds:staff,panelTitle:document.getElementById('tkTitle').value,panelDescription:document.getElementById('tkDesc').value,panelColor:document.getElementById('tkColor').value,welcomeMessage:document.getElementById('tkWelcome').value,categories:cats};
const r=await fetch('/dashboard/api/tickets/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();
if(d.ok){fb.className='fb ok';fb.textContent='✅ Configuration sauvegardée !';}else{fb.className='fb err';fb.textContent='❌ '+(d.error||'Erreur');}
}
loadChannels();
</script>
</body></html>`;
}

module.exports = { initDashboard };
