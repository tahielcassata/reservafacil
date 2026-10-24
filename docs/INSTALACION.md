# Guía de instalación de ReservaFácil

**Lo que necesitás:** una cuenta de Gmail (la del negocio) y una computadora. Después se usa todo desde el celular.
**Tiempo:** unos 15 minutos. **Costo:** $0.

## 1. Crear la planilla
- Entrá a [sheets.google.com](https://sheets.google.com) y creá una hoja en blanco.
- Ponele de nombre **ReservaFácil**.

## 2. Abrir Apps Script
- En la planilla: **Extensiones → Apps Script**.
- Cambiá el nombre del proyecto a **ReservaFácil**.

## 3. Pegar el código (4 archivos)
1. En `Código.gs`, borrá todo y pegá el contenido de `Codigo.gs`.
2. Con el **+** al lado de "Archivos" → **HTML**, creá estos 3 archivos (escribí el nombre **sin** `.html`) y pegá el contenido de cada uno:
   - `Reservar`
   - `Admin`
   - `Estilos`
3. Guardá (Ctrl + S).

## 4. Preparar la planilla (una sola vez)
- En el selector de funciones elegí **`setup`** y tocá **Ejecutar**.
- Aceptá los permisos: *Revisar permisos → tu cuenta → Configuración avanzada → Ir a ReservaFácil (no seguro) → Permitir*.
  Dice "no seguro" solo porque la app es tuya y no pasó por la revisión de Google.
- La planilla queda con las hojas **Turnos** y **Config**.

## 5. Configurar (hoja `Config`)

| Clave | Ejemplo | Para qué sirve |
|---|---|---|
| Negocio | Barbería Juan | Nombre que ve el cliente |
| PrimerTurno | 09:00 | Primer turno del día |
| UltimoTurno | 18:00 | Último turno que se puede reservar |
| MinutosPorTurno | 30 | Cada cuántos minutos hay un turno |
| DiasDeAtencion | 1,2,3,4,5,6 | 1 = lunes … 6 = sábado, 7 = domingo |
| DiasParaAdelante | 14 | Hasta cuántos días adelante se reserva |
| AnticipacionMinutos | 120 | Anticipación mínima para el cliente |
| ClaveDueno | **¡cambiala!** | Clave del panel del dueño |
| WhatsAppNegocio | 5491123456789 | 549 + característica + número, sin 0 ni 15 |

Los cambios en `Config` se aplican al instante, sin volver a publicar.

## 6. Publicar
- **Implementar → Nueva implementación → ⚙️ → Aplicación web**.
- Ejecutar como: **Yo** · Quién tiene acceso: **Cualquier usuario** → **Implementar**.
- Copiá la URL que termina en `/exec`:
  - **Clientes:** la URL tal cual.
  - **Dueño:** la misma URL + `?p=admin`.

Tip: en el celular, abrí cada link y usá **"Agregar a pantalla de inicio"**.

## 7. Uso diario
- Compartí el link de clientes en Instagram, en el estado de WhatsApp o con un QR en el local.
- **Nuevo:** cargás turnos pedidos por teléfono o en persona, bloqueás un horario o un día.
- **Agenda:** ves cada día; cancelás o liberás horarios (con aviso al cliente por WhatsApp).
- **Avisos:** a la tarde abrís esta pestaña, tocás **Enviar** en cada turno del próximo día y mandás el recordatorio.

## Si cambiás el código después
**Implementar → Gestionar implementaciones → ✏️ → Versión: Nueva versión → Implementar.** Así el link sigue siendo el mismo.

## Problemas comunes
- **"Falta la hoja Turnos":** no se ejecutó `setup` (paso 4).
- **"No hay turnos disponibles":** revisá `DiasDeAtencion`, `PrimerTurno` y `UltimoTurno`.
- **El link de WhatsApp abre un número raro:** cargá el celular sin 0 ni 15 (ej. 11 2345 6789).
- **No entra al panel:** la clave es la de `ClaveDueno`, respetando mayúsculas. Si cambió, tocá **Salir del panel** y volvé a entrar.

Los turnos cancelados no se borran: quedan en la hoja **Turnos** con `Estado = Cancelado`, como historial.
