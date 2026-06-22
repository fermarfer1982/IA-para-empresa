# Notas de despliegue para copia comercial

## Entorno recomendado para demo

- Servidor separado de produccion.
- Puerto distinto al servicio productivo.
- `.env.local` creado desde `.env.template`.
- `DEMO_MODE=true`.
- Envio real desactivado.
- SharePoint y Zabbix en read-only o desactivados.

## Arranque local de la copia

Comandos dentro de la copia sanitizada:

```bash
npm install
npm run build
npm run start
```

Para no interferir con produccion, ajustar el script `start` o lanzar Next en otro puerto durante pruebas.

## Validacion minima

- La app arranca.
- No hay secretos en el paquete.
- No existe base SQLite real.
- Comunicaciones carga en modo demo.
- Power BI demo responde o muestra estado claro.
- Voz no ejecuta envio real.
