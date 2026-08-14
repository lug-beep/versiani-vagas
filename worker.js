// Recebe as respostas do formulário do case e grava na planilha do Lug via Sheets API.
// A chave da service account (JSON completo) fica no secret GCP_SA_KEY.

const CAMPOS = [
  ["entry.1618079621", "nome"],
  ["entry.736278758", "telefone"],
  ["entry.795140379", "email"],
  ["entry.1791273485", "sobre"],
  ["entry.2112629785", "porque"],
  ["entry.1172364583", "adaptacao"],
  ["entry.1103844385", "usaIA"],
  ["entry.1443847550", "rotinaIA"],
  ["entry.174193265", "salario"],
];

function b64url(buf) {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function tokenServiceAccount(saJson) {
  const sa = JSON.parse(saJson);
  const now = Math.floor(Date.now() / 1000);
  const enc = new TextEncoder();
  const header = b64url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = b64url(enc.encode(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8", der.buffer, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(`${header}.${claims}`));
  const jwt = `${header}.${claims}.${b64url(sig)}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${jwt}`,
  });
  if (!res.ok) throw new Error(`token ${res.status}: ${await res.text()}`);
  return (await res.json()).access_token;
}

async function gravaCandidatura(request, env) {
  const form = await request.formData();
  const v = Object.fromEntries(CAMPOS.map(([id, nome]) => [nome, (form.get(id) || "").toString().trim()]));

  const ferramentas = form.getAll("entry.1016555155")
    .map(x => x.toString())
    .filter(x => x && x !== "__other_option__");
  const outra = (form.get("entry.1016555155.other_option_response") || "").toString().trim();

  const agora = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const origem = request.headers.get("Referer") || "";

  const linha = [
    agora, v.nome, v.telefone, v.email, v.sobre, v.porque,
    v.adaptacao, v.usaIA, ferramentas.join(", "), outra,
    v.rotinaIA, v.salario, origem,
  ];

  const token = await tokenServiceAccount(env.GCP_SA_KEY);
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${env.SHEET_ID}/values/Respostas!A1:append?valueInputOption=RAW`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values: [linha] }),
    }
  );
  if (!res.ok) throw new Error(`sheets ${res.status}: ${await res.text()}`);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/api/candidatura") {
      try {
        await gravaCandidatura(request, env);
        return new Response("<!doctype html><title>ok</title>Recebido.", {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      } catch (err) {
        console.error("candidatura falhou:", err.message);
        return new Response("erro", { status: 500 });
      }
    }
    return new Response("Not found", { status: 404 });
  },
};
