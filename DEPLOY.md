# Bharat ERP — Production Deploy Guide

**Platform:** Railway · **Database:** MongoDB Atlas · **Runtime:** Node 20

---

## Prerequisites

| Tool | Install |
|------|---------|
| Git | `brew install git` / https://git-scm.com |
| Railway CLI | `npm install -g @railway/cli` |
| Node 20+ | https://nodejs.org (for local testing only) |

---

## Step 1 — MongoDB Atlas (free tier)

1. Go to **https://cloud.mongodb.com** → Create a free account
2. **Create a cluster** → choose the free M0 tier → region closest to India (Mumbai / Singapore)
3. **Database Access** → Add Database User
   - Username: `bharat-erp-prod`
   - Password: generate a strong one (save it — you'll need it in Step 3)
   - Role: **Atlas Admin**
4. **Network Access** → Add IP Address → **Allow Access from Anywhere** (`0.0.0.0/0`)
   - Railway uses dynamic IPs, so this is required
5. **Connect** → Drivers → copy the connection string. It looks like:
   ```
   mongodb+srv://bharat-erp-prod:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
6. Replace `<password>` with your actual password and append the database name:
   ```
   mongodb+srv://bharat-erp-prod:YOURPASS@cluster0.xxxxx.mongodb.net/bharat_erp?retryWrites=true&w=majority
   ```
   Save this as your `MONGODB_URI`.

---

## Step 2 — Anthropic API Key

1. Go to **https://console.anthropic.com** → API Keys → Create key
2. Copy the key — it starts with `sk-ant-api03-...`
3. Save it as your `ANTHROPIC_API_KEY`

---

## Step 3 — Railway Deploy

### 3a. Push code to GitHub

```bash
# In the bharat-erp project folder:
git init
git add .
git commit -m "Bharat ERP v6.0.0 — Sprint 6 (P2P + Sourcing + HR + Dashboard)"

# Create a repo on GitHub, then:
git remote add origin https://github.com/YOUR_USERNAME/bharat-erp.git
git push -u origin main
```

### 3b. Create Railway project

```bash
# Login
railway login

# Create project (or do this in the Railway dashboard)
railway init
# → Name it: bharat-erp
# → Link to your GitHub repo when prompted
```

### 3c. Set environment variables

In the **Railway dashboard** → your service → **Variables** tab, add each variable:

> **Tip:** Click "RAW Editor" in Railway to paste all at once.

```
NODE_ENV=production
MONGODB_URI=mongodb+srv://bharat-erp-prod:YOURPASS@cluster0.xxxxx.mongodb.net/bharat_erp?retryWrites=true&w=majority
ANTHROPIC_API_KEY=sk-ant-api03-YOUR_KEY
API_MASTER_KEY=<output of: openssl rand -hex 32>
ALLOWED_ORIGINS=*
AUTO_APPROVAL_LIMIT=100000
FRAUD_RISK_THRESHOLD=40
HIGH_VALUE_LIMIT=500000
MIN_RFQ_VENDORS=2
MAX_RFQ_VENDORS=5
RFQ_RESPONSE_DAYS=7
APPROVAL_TIMEOUT_HOURS=24
DEFAULT_TENANT_ID=demo-corp
COMPANY_ADDRESS=123 MG Road, Bengaluru 560001
```

WhatsApp (optional — skip for now, add later):
```
TWILIO_ACCOUNT_SID=ACxxxxxxxx...
TWILIO_AUTH_TOKEN=your_token
TWILIO_WA_FROM=whatsapp:+14155238886
FM_WHATSAPP_NUMBER=whatsapp:+91XXXXXXXXXX
VALIDATE_TWILIO_SIG=true
```

### 3d. Deploy

Railway auto-deploys when you push to `main`. Watch the build log in the dashboard.

Or trigger manually:
```bash
railway up
```

Build uses the `Dockerfile` — expect ~60 seconds for the first build.

---

## Step 4 — Seed demo data

Once the service is live, run the seed script against your production database:

```bash
# Set your production MongoDB URI locally
export MONGODB_URI="mongodb+srv://bharat-erp-prod:YOURPASS@cluster0.xxxxx.mongodb.net/bharat_erp?retryWrites=true&w=majority"

npm run seed
```

This inserts:
- 1 tenant (Upskill Global Technologies Pvt Ltd)
- 12 vendors (mix of MSME, services, goods)
- 15 purchase orders
- 10 GRNs
- 40 processed invoices with realistic status distribution

---

## Step 5 — Verify

### Health check
```bash
curl https://<your-app>.up.railway.app/health
```

Expected response:
```json
{
  "status": "ok",
  "platform": "Bharat ERP",
  "version": "6.0.0",
  "sprint": 6,
  "db": "connected",
  "whatsapp": "mock",
  "uptime_s": 42,
  "timestamp": "2026-03-10T..."
}
```

### P2P dashboard
```bash
curl -H "x-api-key: YOUR_API_MASTER_KEY" \
     -H "x-tenant-id: demo-corp" \
     https://<your-app>.up.railway.app/api/p2p/dashboard
```

### Process a test invoice
```bash
curl -X POST \
  -H "x-api-key: YOUR_API_MASTER_KEY" \
  -H "x-tenant-id: demo-corp" \
  -H "Content-Type: application/json" \
  -d '{
    "invoice_number": "INV-TEST-001",
    "vendor_gstin": "29ABCDE1234F1Z5",
    "invoice_date": "2026-03-10",
    "line_items": [
      { "description": "Software consulting", "hsn_sac": "998314", "quantity": 10, "unit_price": 5000, "gst_rate": 18 }
    ]
  }' \
  https://<your-app>.up.railway.app/api/p2p/invoices/process
```

### Sourcing
```bash
curl -X POST \
  -H "x-api-key: YOUR_API_MASTER_KEY" \
  -H "x-tenant-id: demo-corp" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Laptops for engineering team",
    "quantity": 10,
    "department": "Engineering",
    "requested_by": "satish@upskillglobal.in",
    "budget": 800000
  }' \
  https://<your-app>.up.railway.app/api/sourcing/requisitions
```

### HR Payroll
```bash
curl -X POST \
  -H "x-api-key: YOUR_API_MASTER_KEY" \
  -H "x-tenant-id: demo-corp" \
  -H "Content-Type: application/json" \
  -d '{
    "period": { "month": 3, "year": 2026, "initiated_by": "hr@upskillglobal.in" },
    "employees": [
      {
        "employee_id": "EMP001",
        "name": "Ravi Kumar",
        "bank_account": "12345678901234",
        "ifsc": "SBIN0001234",
        "pan": "ABCDE1234F",
        "uan": "100234567890",
        "employment_status": "ACTIVE",
        "salary_components": { "basic": 40000, "hra": 16000, "special_allowance": 8000 }
      }
    ]
  }' \
  https://<your-app>.up.railway.app/api/hr/payroll
```

---

## Step 6 — Point the dashboard at your live URL

Open `dashboard/BharatERPDashboard_Sprint6.jsx` and update line 8:

```js
const BASE_URL = "https://<your-app>.up.railway.app";
const API_KEY  = "your-API_MASTER_KEY-value";
```

---

## WhatsApp Go-Live Checklist (optional)

- [ ] Create Twilio account at https://twilio.com
- [ ] Enable WhatsApp Sandbox (Messaging → Try it out → Send a WhatsApp)
- [ ] Set webhook URL in Twilio console:
      `POST https://<your-app>.up.railway.app/webhook/whatsapp`
- [ ] Add `TWILIO_*` variables in Railway dashboard
- [ ] Set `VALIDATE_TWILIO_SIG=true`
- [ ] Change `FM_WHATSAPP_NUMBER` to your Finance Manager's actual number
- [ ] Test with `/webhook/whatsapp/simulate` endpoint

---

## Estimated Monthly Cost

| Service | Tier | Cost |
|---------|------|------|
| Railway | Hobby ($5 credit/mo) | ~₹0–420/mo |
| MongoDB Atlas | M0 free | ₹0 |
| Anthropic Claude | Pay-per-use | ~₹200–800/mo |
| Twilio WhatsApp | Pay-per-message | ~₹5/message |
| **Total MVP** | | **< ₹1,500/mo** |

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `db: "disconnected"` in /health | Check MONGODB_URI — ensure Atlas Network Access allows `0.0.0.0/0` |
| `403 Invalid API key` | Include header `x-api-key: YOUR_API_MASTER_KEY` |
| `WhatsApp: mock` | TWILIO_* env vars not set — this is fine for demos |
| Build fails at `npm install` | Check Node version — requires Node 20+ |
| Agents return low confidence | ANTHROPIC_API_KEY not set or invalid |

---

*Bharat ERP v6.0.0 · Upskill Global Technologies Pvt. Ltd. · Sprint 6*
