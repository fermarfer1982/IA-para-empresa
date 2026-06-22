# Instalar demo en otro equipo

## Opcion A - Node.js

1. Copiar el paquete:

```bash
infra-agent-web-template.tar.gz
```

2. Descomprimir:

```bash
tar -xzf infra-agent-web-template.tar.gz
cd infra-agent-web-template
```

3. Crear configuracion demo:

```bash
cp productization/config/.env.template .env.local
```

4. Sustituir o copiar valores desde:

```text
productization/portable-demo/profiles/generic-demo.env
```

5. Instalar y arrancar:

```bash
npm install
npm run build
npx next start -H 127.0.0.1 -p 3020
```

6. Abrir:

```text
http://127.0.0.1:3020
```

## Opcion B - Docker

1. Copiar y descomprimir el paquete.
2. Crear `.env.local` desde `productization/config/.env.template`.
3. Ejecutar:

```bash
docker compose -f docker-compose.demo.yml up --build
```

4. Abrir:

```text
http://127.0.0.1:3020
```

## Reglas de seguridad

- No usar `.env.local` de produccion.
- No usar bases SQLite reales.
- No usar tokens reales salvo en piloto controlado.
- Mantener `COMMUNICATIONS_DISABLE_REAL_SEND=true`.
- Mantener writes desactivados salvo contrato explicito.
