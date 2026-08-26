# TOBIAS.PLUS

Plataforma base de planes, créditos, usuarios y pagos.

## Stack
- Node.js + Express
- PostgreSQL
- HTML/CSS/JS vanilla
- JWT en cookie HttpOnly
- bcrypt para contraseñas
- Adaptador de pagos Nequi separado del dominio

## Ejecutar localmente

1. Instala Node.js 20+.
2. Crea PostgreSQL.
3. Copia `.env.example` a `.env` y configura `DATABASE_URL` y `JWT_SECRET`.
4. Ejecuta:
   npm install
   npm run db:init
   npm start
5. Abre http://localhost:3000

## Railway

Crea un servicio PostgreSQL y el servicio de la app. Railway expone `DATABASE_URL` al servicio cuando se referencia la variable del Postgres.

Variables mínimas:
- DATABASE_URL
- JWT_SECRET
- APP_URL
- NODE_ENV=production

No pongas secretos de Nequi en el repositorio. Configúralos como variables privadas en Railway.

## Nequi

El proyecto incluye un adaptador preparado para integrar el API oficial, pero NO inventa endpoints, credenciales ni firmas. Antes de producción debes solicitar/habilitar la API de Nequi, obtener credenciales sandbox y seguir la documentación oficial. El endpoint `/api/payments/nequi/start` devuelve un error controlado mientras no estén configuradas las credenciales.

El webhook `/api/webhooks/nequi` está preparado para recibir una referencia y un estado normalizado. En producción, adapta la verificación de firma y el mapeo de estados exactamente a la documentación/contrato de Nequi.

Regla de negocio: un plan/crédito SOLO se activa cuando una transacción pasa a `PAID` después de una confirmación válida del proveedor.

## Seguridad
- Nunca aceptes `paid=true` desde el navegador.
- Usa una referencia única por pago.
- Usa idempotencia en el procesamiento del webhook.
- Guarda auditoría.
- Añade rate limiting, CSRF y observabilidad antes de producción de alto tráfico.
