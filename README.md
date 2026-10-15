# claude-pets (mod "mascotas" para Claude Code)

Mascotas de pixel art que viven en un pane de Claude Code y muestran, en tiempo real, **qué hace la sesión y cada subagente**: leer, escribir, buscar, ejecutar, copiar archivos, esperar, fallar o descansar. Cada subagente tiene su propia mascota única, con nombre, y puedes hablarle por su nombre.

- **0 tokens** en el uso normal: el mod solo escucha eventos de Claude Code. Solo gastan tokens las funciones de IA que tú pides (`/pets ia`).
- Sin servidores ni telemetría: tus preferencias se guardan en el almacén local del plugin.

## Instalación

En una sesión de terminal de Claude Code:

```
/plugin install mascotas --marketplace Jul879n/claude-pets
```

Responde `y` para agregar el marketplace y elige el alcance (usuario para tenerlo en todos tus proyectos). O desde un shell:

```
claude plugin install mascotas --marketplace Jul879n/claude-pets
```

Después abre una sesión nueva (o `/reload-plugins`): el pane se abre solo. Con `/pets` ves la ayuda.

> Usa la API de *mods* de Claude Code, que está en acceso temprano y puede cambiar entre versiones (probado con 2.1.300). Necesita una terminal con colores de 24 bits.

## Qué muestra

- **Mascota principal** (izquierda) con su ánimo: pensando, leyendo, escribiendo, ejecutando, esperando agentes, error, contenta o dormida. El cuerpo entero se mueve en cada ánimo y respira en reposo.
- **Subagentes** (derecha): tarjetas con su mascota, estado, acción en curso, barra de actividad y tiempo; desde 5 agentes pasan a una tabla.
- **Escenas** por acción: copiar, mover, borrar, leer documentos o código, buscar, descargar, instalar, probar, git, delegar.
- Línea de estado con agentes vivos, avisos al terminar o fallar un agente y detección de agentes atascados.

## Comandos (`/pets`)

| Comando | Qué hace |
|---|---|
| `/pets` o `/pets ayuda` | Ayuda con todos los subcomandos |
| `on` / `off` / `abrir` / `cerrar` | Activar, desactivar o reabrir el pane |
| `tipo`, `nombre`, `color`, `acento`, `accesorio`, `ojos`, `reset` | Personalizar la mascota principal (tipos: cat, owl, robot, fox, dog, bunny, ghost; accesorios: sombrero, corona, lentes, corbata) |
| `generar [texto]` | Mascota al azar, o siempre la misma para un texto |
| `set <nombre>` / `set guardar` / `set borrar` | Sets temáticos (animales, robots, fantasia, espacio) y propios para las mascotas de los subagentes |
| `mis`, `usar`, `guardar`, `quitar` | Tu listado de mascotas (lo generado se guarda solo) |
| `decir <nombre> <mensaje>` | Habla con un subagente por el nombre de su mascota (también `@Nombre mensaje` en el prompt); no pasa por el modelo |
| `img <ruta o URL> [nombre]` | Convierte una imagen en mascota de 32x32, sin tokens (necesita `python3` y `sips`, macOS) |
| `ia <descripción>` | Busca una imagen de referencia en la web con el modelo principal y crea la mascota (consume tokens); `ia rapido` usa solo Haiku; `web off` desactiva la búsqueda |
| `estilo pixel\|ascii`, `angosto`, `calma`, `avisos`, `historial`, `editar`, `estado` | Opciones de visualización y utilidades |

## Desarrollo

```
claude plugin validate .
claude plugin test .
```

Estructura: `hooks/register.tsx` (eventos, comandos y pane), `hooks/sprites.ts` (formas, expresiones y animación), `hooks/img2art.ts` (conversión de imágenes), `types/index.d.ts` (contrato de estado).

## Licencia

MIT
