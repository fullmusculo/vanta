# Transcripción con tiempos para el editor

El editor acepta una de estas fuentes de palabras reales:

1. **OpenAI API**: configure `OPENAI_API_KEY` en el servidor. La ruta actual usa `whisper-1` con tiempos por palabra; la suscripción ChatGPT no suministra esta credencial.
2. **whisper.cpp local**: instale `whisper-cli` y un modelo multilingüe por sus vías oficiales, compruebe sus licencias y establezca rutas absolutas `WHISPER_CPP_BIN` y `WHISPER_CPP_MODEL`. Opcionalmente use `TRANSCRIPTION_PROVIDER=whisper-cpp` cuando haya varios proveedores configurados. Vanta no descarga ejecutables ni pesos, ni envía ese audio a un tercero en modo local.
3. **Importación verificada**: `PUT /api/projects/:id/transcript` o herramienta MCP `import_verified_transcript` con `words[]` que incluya `word`, `start`, `end` y `confidence`. El material debe haberse transcrito, nunca inferirse de fotogramas.

Después de analizar, el trabajo `transcribe` reutiliza el WAV local a 16 kHz, mono, o lo extrae del vídeo existente si se importó un checkpoint sin caché. La salida se valida contra el contrato de palabras; el backend remapea captions tras los cortes y conserva el historial de revisiones. La variante local usa JSON completo con tokens temporizados y una caché diferenciada por modelo. Las marcas proceden del motor de reconocimiento y requieren revisión humana para nombres propios, cifras y sincronización.

**Estado de esta prueba:** el adaptador local y el parseo están implementados y verificados con un ejemplo estructurado, pero en este entorno no hay binario, pesos multilingües ni clave de API autorizada. El vídeo entregado sigue sin subtítulos. La próxima prueba funcional requiere instalar el modelo o habilitar una credencial de API mediante el sistema de secretos autorizado.
