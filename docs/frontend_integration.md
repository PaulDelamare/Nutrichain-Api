# NutriChain API - Frontend Integration Guide (2026)

Welcome to the NutriChain API. This documentation will help integrators connect their React/Vue/Angular frontend applications to the backend Modulith.

## 1. Authentication & Security

All requests to the backend must be authenticated using the API Key and, for protected routes, a Bearer token provided by Better-Auth.

### Global Headers Required:
Every request made to `/api/auth/*` or any protected business route MUST include the following Header:
```http
x-api-key: <YOUR_FRONTEND_API_KEY>
```
*(Contact the backend team to get your environment's API Key).*

### Authentication Flow (Better-Auth)

We use **Better-Auth** to handle user sessions and OIDC (B2B Active Directory).

#### 1. Sign Up (First login or Invited User)
```http
POST /api/auth/sign-up/email
x-api-key: <YOUR_FRONTEND_API_KEY>

{
  "email": "employee@factory.com",
  "password": "SecurePassword123",
  "name": "Jane Doe"
}
```
*Note: Due to security (`guardSignUp.middleware`), this route will return a `403 Forbidden` if the email has not been invited by an Administrator, EXCEPT for the very first user of the database.*

#### 2. Sign In
```http
POST /api/auth/sign-in/email
x-api-key: <YOUR_FRONTEND_API_KEY>

{
  "email": "employee@factory.com",
  "password": "SecurePassword123"
}
```
*Success Response will include your Set-Cookie and a Token.*

#### 3. Accessing Protected Business Routes
When calling protected endpoints (e.g., `/api/me`, `/api/logistics/lots`...), you must pass the authorization header and the API Key:
```http
GET /api/me
x-api-key: <YOUR_FRONTEND_API_KEY>
Authorization: Bearer <TOKEN>
```

---

## 2. IoT Telemetry

The IoT module handles massive sensor data ingestion (up to 11,000 pings/second) and relies on MongoDB Time-Series.

### Send Sensor Ping
```http
POST /api/telemetry/ping
x-api-key: <YOUR_FRONTEND_API_KEY>

{
  "sensor_id": "sensor-UUID-1234",
  "temperature": -18.5,
  "humidity": 45.2,
  "battery_level": 89
}
```
*Returns `202 Accepted` for fast Fire-and-Forget telemetry logic.*

### Get Sensor History
```http
GET /api/telemetry/sensor-UUID-1234/history?limit=50
x-api-key: <YOUR_FRONTEND_API_KEY>
```

---

## 3. Supply Chain Modules (Coming Soon)

The following modules are mapped in the architecture and their endpoints will be documented once implemented:
- **Logistics**: Managing `Reception`, `Expedition`, `Supplier`, and `Client`.
- **Traceability**: Managing `Batch` (Lot), `Processing` (Transformation), and `QualityCheck`.
- **Core**: Managing Plant setup (`Location`, `Equipment`).
# Docs: Intégration Frontend API NutriChain

Ce diagramme et ces instructions vous permettront de communiquer avec l'API.

## URL de base
L'API tourne en développement sur : `http://localhost:3000/api`

## Authentification
L'API est strictement B2B avec deux niveaux de sécurité :

1. **API Key Globale** 
   Toutes les requêtes vers `/api/auth/*` doivent inclure un Header particulier.
   - `x-api-key : NUTRICHAIN_YOUR_SECRET_API_KEY`

2. **Système d'Invitations ("Guard")**
   Vous ne pouvez pas vous inscrire si vous n'avez pas de jeton d'invitation généré par un admin (le tout géré par Better-Auth), à moins que la BDD ne soit entièrement vide.

### Flux Login
```js
const response = await fetch("http://localhost:3000/api/auth/sign-in/email", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": "NUTRICHAIN_YOUR_SECRET_API_KEY"
  },
  body: JSON.stringify({
    email: "test@domain.com",
    password: "password123"
  })
});
```

## Structure BDD (Anglais)
Toutes nos entités métiers ont été traduites (Ex: `Batch`, `Equipment`, `Supplier`, `Location`).

Lors de la récupération de profils utilisateurs (Auth), le backend délègue la vérification de mots de passe à notre module de session. Vous pouvez stocker de manière sécurisée le Bearer token renvoyé selon le client Better-Auth que vous embarquez en front (`@better-auth/client`).

## Télémétrie / IoT
L'API ingère les signaux de capteurs sur `/api/iot/telemetry` vers un serveur MongoDB TimeSeries.
Vous n'aurez généralement qu'à faire des requêtes `GET` pour lire ces historiques pour vos dashboards en front.