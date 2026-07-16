// ============================================================
//  cc-api.js  —  Extension API pour ton serveur Render (MultiBOT)
//  Reçoit les états des computers CC:Tweaked et les sert au dashboard.
//
//  Intégration dans ton serveur existant (MultiBOT) :
//
//    const express = require("express");
//    const app = express();
//    app.use(express.json());
//
//    const { ccRouter, initCC } = require("./cc-api");
//    initCC(process.env.MONGODB_URI);   // même URI que MultiBOT
//    app.use("/cc", ccRouter);
//
//  Puis tes routes deviennent :
//    POST https://ton-app.onrender.com/cc/update
//    GET  https://ton-app.onrender.com/cc/computers
// ============================================================

const express = require("express");
const { MongoClient } = require("mongodb");

const ccRouter = express.Router();

let collection = null;

// ---- Connexion Mongo (réutilise l'URI de MultiBOT) ----
async function initCC(mongoUri, dbName = "cctweaked", collName = "computers") {
  if (!mongoUri) {
    console.error("[CC-API] MONGODB_URI manquant");
    return;
  }
  try {
    const client = new MongoClient(mongoUri);
    await client.connect();
    collection = client.db(dbName).collection(collName);
    // index TTL optionnel : supprime un computer inactif depuis 1h
    await collection.createIndex({ lastSeen: 1 }, { expireAfterSeconds: 3600 });
    console.log("[CC-API] Connecté à MongoDB, collection:", collName);
  } catch (e) {
    console.error("[CC-API] Erreur connexion Mongo:", e.message);
  }
}

// ---- Petit token partagé pour éviter que n'importe qui poste ----
//  Mets la même valeur dans l'agent Lua (CC_TOKEN) et dans Render (env CC_TOKEN).
const TOKEN = process.env.CC_TOKEN || "change-moi";

// ============================================================
//  POST /cc/update  — un computer envoie son état
// ============================================================
ccRouter.post("/update", async (req, res) => {
  if (!collection) return res.status(503).json({ error: "db not ready" });

  const body = req.body || {};
  if (body.token !== TOKEN) {
    return res.status(401).json({ error: "bad token" });
  }
  if (body.id === undefined || body.id === null) {
    return res.status(400).json({ error: "id manquant" });
  }

  const doc = {
    id: String(body.id),
    label: body.label || ("computer_" + body.id),
    type: body.type || "computer",         // "turtle" | "computer"
    fuel: body.fuel ?? null,               // nombre ou "unlimited"
    pos: body.pos || null,                 // { x, y, z } ou null
    status: body.status || "idle",         // texte libre : "mining", "idle"...
    detail: body.detail || "",             // ligne d'info libre
    inventory: Array.isArray(body.inventory) ? body.inventory.slice(0, 16) : [],
    lastSeen: new Date(),
  };

  try {
    await collection.updateOne(
      { id: doc.id },
      { $set: doc },
      { upsert: true }
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
//  GET /cc/computers  — le dashboard récupère tout
// ============================================================
ccRouter.get("/computers", async (_req, res) => {
  if (!collection) return res.status(503).json({ error: "db not ready" });
  try {
    const list = await collection
      .find({}, { projection: { _id: 0 } })
      .sort({ label: 1 })
      .toArray();

    const now = Date.now();
    // marque en ligne / hors ligne selon la fraîcheur (30s)
    const withState = list.map((c) => ({
      ...c,
      online: now - new Date(c.lastSeen).getTime() < 30000,
    }));
    res.json({ computers: withState, serverTime: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
//  DELETE /cc/computers/:id  — retirer un computer manuellement
// ============================================================
ccRouter.delete("/computers/:id", async (req, res) => {
  if (!collection) return res.status(503).json({ error: "db not ready" });
  if (req.query.token !== TOKEN) return res.status(401).json({ error: "bad token" });
  try {
    await collection.deleteOne({ id: String(req.params.id) });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = { ccRouter, initCC };
