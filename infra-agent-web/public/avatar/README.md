# Avatar videos

Colocar aqui los videos del avatar para la pantalla `/agent-display`.

Nombres esperados por la aplicacion:

- `avatar-en-reposo.mp4`
- `avatar-hablando.mp4`

Los nombres originales recibidos pueden copiarse asi:

```bash
cp "avatar en reposo.mp4" public/avatar/avatar-en-reposo.mp4
cp "avatar hablando.mp4" public/avatar/avatar-hablando.mp4
```

Formato esperado:

- MP4 H.264
- 1920x1080
- loop de 8 segundos
- sin pista de audio

Si los archivos no existen, `/agent-display` muestra un fallback visual y la ruta sigue cargando.
