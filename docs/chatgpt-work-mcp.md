# ChatGPT Work como director interactivo

Este puente usa el ChatGPT de la conversación para proponer cambios estructurados. **No convierte la suscripción ChatGPT en una clave de API** ni ejecuta peticiones a los modelos desde el servidor de Vanta. El render y las validaciones se ejecutan localmente.

## Ejecutar en la máquina de edición

```bash
npm ci
DATA_DIR=/ruta/segura/vanta-data npm run editor:api
DATA_DIR=/ruta/segura/vanta-data npm run editor:worker
DATA_DIR=/ruta/segura/vanta-data npm run editor:mcp
```

MCP escucha solo en `127.0.0.1:4318/mcp`. No acepta `Origin` de navegador ni hosts externos. Configure `MCP_SHARED_TOKEN` si lo va a reenviar mediante un túnel autenticado; no publique el puerto local directamente. El navegador/editor escucha en `127.0.0.1:4317`.

Para importar un checkpoint local creado anteriormente:

```bash
DATA_DIR=/ruta/segura/vanta-data npm run editor:import -- /ruta/al/checkpoint.json
```

La importación no sobrescribe proyectos existentes. Comprueba contrato, archivos locales y tiempos de muestreo, y recrea las miniaturas visuales. Los checkpoints son archivos de operador de confianza, nunca entrada arbitraria de una herramienta de IA.

## Conectar con ChatGPT Work

Active modo de desarrollador y añada un complemento MCP personal con una de estas vías:

- **Túnel MCP seguro:** cree un túnel en OpenAI Platform, vincúlelo al espacio de trabajo y ejecute `tunnel-client` en la misma red que Vanta, reenviando el MCP local. Requiere identificador de túnel, clave de ejecución de Platform y salida HTTPS a la API.
- **HTTPS propio:** publique un proxy HTTPS protegido por autenticación de usuario y reenvíe las solicitudes al MCP local. La protección de host local de este servidor requiere que el proxy entregue `Host: 127.0.0.1:4318` y elimine `Origin`. La autenticación externa y el TLS deben estar activos antes de conectar ChatGPT.

En la configuración del complemento, verifique que se descubran `list_projects`, `get_edit_context`, `view_sample_frames`, `apply_edit_decision`, `import_verified_transcript`, `queue_render` y `get_render_status`.

Para hacer cambios, ChatGPT lee primero el contexto con su revisión, inspecciona los fotogramas disponibles, propone operaciones del esquema y llama a `apply_edit_decision` con esa revisión. Un conflicto obliga a recargar. `queue_render` lanza el trabajo asíncrono; `get_render_status` permite observarlo. Las instrucciones y las propuestas quedan en el historial del proyecto.

Los fotogramas no proporcionan una transcripción. Para subtítulos con texto real, primero genere una transcripción verificable con tiempos por palabra e impórtela con `import_verified_transcript`. La generación local de esa transcripción depende de tener instalado un motor de voz y sus pesos, o de configurar un proveedor de API independiente. Nunca se debe inferir una transcripción a partir de imágenes.

Las opciones de transcripción y sus límites están en [Transcripción con tiempos](ASR.md).

## Prueba local

```bash
DATA_DIR=/ruta/segura/vanta-data node scripts/test-mcp.mjs ID_DEL_PROYECTO
```

Esta prueba conecta un cliente MCP real, consulta el plan y fotogramas, y verifica que se rechacen las revisiones obsoletas y las operaciones fuera de contrato.
