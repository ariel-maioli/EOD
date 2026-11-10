# EOD

Aplicación web para registrar y consultar visitas de mantenimiento a predios. La interfaz está hecha con HTML, CSS y JavaScript: no requiere compilación ni instalación de herramientas. Usa `supabase-js` desde un CDN y Supabase para autenticación y datos, por lo que necesita conexión a internet.

## Configuración de Supabase

1. Creá un proyecto Supabase.
2. En **SQL Editor**, ejecutá el contenido completo de [`schema.sql`](./schema.sql). Es el esquema completo de EOD: crea o actualiza las tablas, índices, funciones, triggers, permisos y políticas RLS, incluido el inventario y las asignaciones de predios. Para una instalación nueva, ejecutalo antes de conectar la aplicación.
3. En **Authentication**, desactivá el registro público. Creá o invitá las cuentas de los técnicos desde **Authentication → Users**.
4. Promové la cuenta administradora en **SQL Editor**, usando el correo de esa cuenta:

   ```sql
   UPDATE public.profiles
   SET role = 'admin'
   WHERE lower(email) = lower('correo-del-admin@example.com');
   ```

5. Para encontrar los datos de conexión, abrí el proyecto en el dashboard de Supabase y, en el menú lateral, entrá a **Project Settings** (ícono de engranaje) → **API**. Copiá el valor del campo **Project URL**; debe tener esta forma `https://<project-ref>.supabase.co`. No uses la URL de GitHub Pages, una URL de redirección de Authentication ni la cadena de conexión de la base de datos. En la misma configuración, copiá la clave pública **anon** o **publishable** (según cuál muestre tu proyecto) en [`config.js`](./config.js):

   ```js
   window.EOD_CONFIG = Object.freeze({
     supabaseUrl: "https://TU-PROYECTO.supabase.co",
     supabaseAnonKey: "TU-CLAVE-PUBLICA"
   });
   ```

   Pegá la URL completa de **Project URL** en `supabaseUrl` y la clave pública en `supabaseAnonKey`. La clave pública se utiliza desde el navegador y no reemplaza las políticas de acceso. **Nunca uses ni publiques la clave `service_role` o una clave secreta.**

6. En **Authentication → URL Configuration**, configurá **Site URL** con la URL publicada, por ejemplo `https://ariel-maioli.github.io/EOD/`. EOD no ofrece recuperación ni cambio de contraseña desde la interfaz; quitar esa opción no impide que Supabase Auth permita cambiarla por otros medios.

## Desarrollo local con un proyecto Supabase separado

Para probar sin afectar producción, creá `config.dev.js` en la carpeta raíz `EOD` con la **Project URL** y la clave pública **anon/publishable** de **EOD-dev**:

```js
window.EOD_CONFIG = Object.freeze({
  supabaseUrl: "https://TU-PROYECTO-DEV.supabase.co",
  supabaseAnonKey: "TU-CLAVE-PUBLICA-DEV"
});
```

El archivo `config.dev.js` está excluido de Git. Abrí `index.html?env=dev` en el navegador; por ejemplo, `file:///C:/ThNet/EOD/index.html?env=dev`. Ese modo carga únicamente `config.dev.js` y no usa la configuración de producción si el archivo falta o no carga. Para la aplicación publicada, seguí usando `index.html` sin `?env=dev`; esta usa `config.js` y producción.

Usá la clave pública de Supabase, nunca la clave `service_role` ni una clave secreta. La clave pública no concede permisos por sí sola; el acceso a los datos depende de las políticas RLS.

## Actualizar un proyecto Supabase existente

Ejecutá el contenido completo de [`schema.sql`](./schema.sql) en **SQL Editor** para actualizar un proyecto EOD existente. El archivo incluye las definiciones actuales de inventario y asignaciones, permisos, pagos, auditoría y bloqueo de fechas futuras. Crea o actualiza objetos y políticas; no borra visitas, predios, perfiles ni auditoría. Las visitas antiguas no se asocian automáticamente a asignaciones nuevas. Si el proyecto solo tiene datos de prueba, podés limpiar EOD-dev después de aplicar el esquema y volver a generar los datos; seguí la sección [Generar datos de prueba](#generar-datos-de-prueba). No confundas el esquema con [`clear_production_visits.sql`](./clear_production_visits.sql), que sí es destructivo.

No necesitás ejecutar scripts de migración separados: `schema.sql` es la fuente única del esquema vigente. Después, en **Table Editor → profiles**, completá `display_name` para mostrar nombres en lugar de correos; si queda vacío, la aplicación usa el correo como alternativa.

## Roles y uso de la aplicación

- **Técnicos:** solo pueden registrar una visita para un predio existente que esté asignado actualmente a su usuario. Al guardar la visita, la asignación queda completada. Pueden consultar y editar sus propias visitas activas aunque el predio ya no aparezca entre sus asignaciones pendientes.
- **Administrador:** puede editar visitas de cualquier técnico, archivar y restaurar visitas o predios, procesar y corregir pagos, consultar actividad y exportar CSV.
- **Predios:** el admin dispone de un panel para agregar predios al inventario y, por separado, asignarlos a un técnico o a sí mismo. La carga acepta listas separadas por coma; informa los nuevos, existentes, repetidos, inválidos y errores. Solo se aceptan seis dígitos sin cero inicial.
- **Asignaciones:** cada predio puede tener un único responsable a la vez. Reasignar cierra la asignación anterior y conserva su historial. Registrar una visita completa la asignación vigente; para visitar de nuevo, el admin debe asignarlo otra vez.
- **Importar visitas:** en **Predios**, el admin puede cargar un CSV y elegir como responsable a un técnico o administrador. El archivo requiere las columnas `Predio, Notas, Fecha, Contacto, Celular` (el separador puede ser coma o punto y coma); la fecha debe estar en formato `DD/MM/AAAA`. Se admite una fila por predio y un máximo de 2.000 filas/5 MB. Se importan parcialmente las filas válidas, y se informa el motivo de cada fila rechazada. En las visitas importadas, si `Contacto` supera 50 caracteres o `Notas` supera 250, se guarda el texto truncado al límite y se identifica la fila, el predio y el campo ajustado en el resumen. Cada predio debe existir, no estar archivado y tener una asignación activa al responsable elegido; cada visita importada completa esa asignación.
- **Cobertura:** el panel muestra el inventario por estado y permite filtrarlo por técnico o administrador asignado. Estima los días hábiles de cobertura por responsable. Los valores iniciales son 2 predios por día hábil y alerta a 15 días; el admin puede modificarlos. El cálculo usa lunes a viernes.
- El administrador puede elegir un técnico en **Ver como** para revisar sus datos y la interfaz de técnico. Es una vista de solo lectura: no cambia la sesión ni los permisos reales del administrador.
- La vista previa sirve para comprobar la presentación y los datos filtrados, no para verificar permisos reales de un técnico.
- Los datos se vuelven a cargar al entrar en cada sección. Al actualizar la página, la sesión existente se restaura y se vuelven a cargar los datos.
- El saludo cambia según la hora de Argentina: «Buenos días» (05:00–11:59), «Buenas tardes» (12:00–19:59) y «Buenas noches» (20:00–04:59).

## Modo de mantenimiento

El modo de mantenimiento se controla desde **Supabase → SQL Editor**. Primero, ejecutá el `schema.sql` actualizado en el proyecto conectado a EOD y publicá esta versión de la aplicación. Antes de iniciar una tarea de mantenimiento o publicar cambios posteriores, activá el modo:

```sql
UPDATE public.maintenance_settings
SET enabled = true, updated_at = now()
WHERE id = true;
```

Mientras esté activo, solo el administrador puede ingresar; las sesiones de los técnicos se cierran al detectar el cambio (normalmente en un máximo de 15 segundos, o al volver a la pestaña). Las políticas y funciones de Supabase también bloquean el acceso de los técnicos a los datos. Al terminar el mantenimiento y publicar los cambios, desactivalo:

```sql
UPDATE public.maintenance_settings
SET enabled = false, updated_at = now()
WHERE id = true;
```

Verificá que estés en el proyecto Supabase correcto al ejecutar ambos comandos. Si no se puede consultar el estado, la aplicación impide que los técnicos continúen.

## Registrar visitas

- El número de predio debe tener seis dígitos, comenzar entre 1 y 9, y no puede estar vacío.
- El predio debe estar previamente cargado al inventario y asignado al usuario que registra la visita; la visita no crea predios automáticamente.
- La fecha se propone inicialmente como hoy y no se permiten fechas futuras, tampoco al editar.
- El contacto es obligatorio (hasta 50 caracteres); el celular es obligatorio y debe tener 10 dígitos, sin prefijo `0` ni `15`; las notas son opcionales (hasta 250 caracteres) y pueden incluir información útil para futuras visitas o auditorías.
- Solo puede existir una visita por predio y fecha.
- Desde **Predios → Importar visitas desde CSV**, el administrador puede cargar visitas en lote a nombre de un técnico o administrador. El archivo debe incluir `Predio`, `Notas`, `Fecha`, `Contacto` y `Celular`; la fecha se escribe como `DD/MM/AAAA`. Se puede descargar una plantilla vacía desde el panel. Las filas con datos inválidos, predios inexistentes/archivados/sin asignación activa o una visita ya existente se informan y no detienen la importación de las demás. En las visitas aceptadas, contacto y notas que exceden sus límites se truncan, y el resumen indica los campos truncados. Cada predio debe aparecer como máximo una vez en el archivo y la visita aceptada completa su asignación activa. Exportá desde Excel como **CSV UTF-8**.
- No se puede registrar una visita mientras el predio esté archivado. El administrador debe restaurar el predio primero.
- Tras guardar, la confirmación aparece dentro del formulario y desaparece al empezar a escribir el registro siguiente o después de 4,5 segundos. El foco vuelve al número de predio para facilitar la carga consecutiva. Los errores se anuncian y la pantalla se desplaza hasta el mensaje.

## Buscar visitas

Al ingresar, el administrador abre **Buscar visitas** con las fechas de lunes a domingo de la semana actual (hora de Argentina), todos los técnicos y visitas activas. Los técnicos ven sus últimas 25 visitas. Al escribir un predio, nombre o celular, cambiar fechas o (para el administrador) cambiar técnico o estado, la aplicación busca en todos los registros que ese usuario puede consultar. La consulta completa se pagina para no quedar limitada al máximo de filas de una sola respuesta de Supabase. Los resultados se ordenan por fecha de visita descendente; si coinciden, se prioriza el registro más reciente.

- **Limpiar filtros** borra la búsqueda y las fechas. Para el administrador también selecciona todos los técnicos y estados, incluidas las visitas archivadas; para los técnicos muestra todas las visitas disponibles, respetando las restricciones habituales. Al cambiar un filtro manualmente, la búsqueda sin criterios vuelve a mostrar las últimas 25.
- **Técnicos:** en la pantalla de búsqueda, la aplicación muestra solo predios activos y los datos básicos de cada visita: número, fecha, contacto y celular. No tienen filtros por técnico ni por estado. Cada fila permite abrir WhatsApp para el número argentino o copiar el celular. Esta limitación de campos corresponde a la interfaz; no implica que todas las demás columnas estén restringidas en la API de Supabase.
- **Administrador:** conserva acceso a visitas activas y archivadas, ve los detalles y acciones administrativas, y puede filtrar por técnico y estado.
- El administrador puede exportar a CSV los resultados filtrados o los registros activos. La opción **Exportar todos los activos** fuerza el estado activo, pero conserva la búsqueda, los filtros de fecha y el filtro de técnico actuales. El archivo usa `;` como separador.

Archivar un predio no cambia el estado individual de sus visitas, pero las oculta mientras el predio permanezca archivado. Al restaurar el predio, vuelven a aparecer las visitas que no se archivaron por separado. Archivar una visita afecta solo a esa visita.

## Pagos

Solo el administrador puede procesar pagos. Se ingresan números de predio separados por coma; antes de procesarlos, la aplicación solicita confirmación e informa cuántas visitas únicas se marcarán como abonadas. Los números de predio repetidos se cuentan y procesan una sola vez. Si se cancela la confirmación, no se procesa ningún pago. Al continuar, se marca como abonada la visita activa pendiente de pago más reciente de cada predio y se registra la fecha del proceso y quién lo realizó. También se puede marcar como abonada una visita específica desde su fila en la lista de pendientes. Si un predio no existe, está archivado o no tiene visitas pendientes, la aplicación informa el motivo y permite decidir si continúa con los siguientes números. Las correcciones del pago solo están disponibles para el admin y quedan registradas en la auditoría.

También se pueden importar pagos desde **Pagos → Importar pagos desde CSV**. El archivo debe tener exactamente las columnas `Predio` y `Fecha` (coma o punto y coma como separador) y usar fecha `DD/MM/AAAA`. Se admite un máximo de 2.000 filas y 5 MB. La fecha se registra a las 00:00 de Argentina; no se aceptan fechas futuras. Cada predio puede aparecer una vez: si se repite, se procesa la primera fila válida y se informa el duplicado. Se aplican los pagos fila por fila a la visita activa pendiente de pago más reciente; predios inválidos, inexistentes, archivados o sin visitas pendientes se informan sin impedir el procesamiento de las demás filas. Se puede descargar una plantilla CSV desde el panel.

En la sección **Pagos**, las columnas **Predios abonados el [fecha]** y **Pendientes** aparecen en paralelo en pantallas amplias y apiladas en pantallas angostas. La fecha corresponde al día más reciente con pagos en el historial visible, cualquiera sea el día de la semana; debajo del título se muestra la cantidad de visitas abonadas ese día. Si todavía no hay pagos, la fecha aparece como «—». La lista de pendientes muestra todas las visitas activas no abonadas, una fila por visita, incluso cuando hay más de una visita sin pagar del mismo predio; incluye las visitas completadas cuyo predio ya no figura entre las asignaciones activas del técnico. Los técnicos ven sus propios predios, con número y fecha, sin repetir su nombre; el administrador ve los registros de todos los técnicos, con sus nombres, y puede marcar cada visita pendiente individualmente o corregir pagos ya registrados.

## Actividad reciente

Solo el administrador tiene acceso a esta sección. Muestra los eventos de auditoría de los últimos 30 días, con un máximo de 500 eventos por carga. Los nombres de usuario, predios, fechas y acciones se presentan en forma legible. La base conserva el historial sin purgarlo automáticamente, salvo cuando se ejecuta el script de limpieza.

## Limpiar datos (acción destructiva)

[`clear_production_visits.sql`](./clear_production_visits.sql) es destructivo: elimina todas las visitas, las asignaciones, todos los predios y todo el historial de auditoría; conserva las cuentas de Supabase Auth, `public.profiles` y la configuración de cobertura. El script debe ejecutarse después de aplicar el esquema actualizado, bloquea las tablas durante la operación y utiliza una transacción para revertir los cambios si ocurre un error.

Revisá el contenido y verificá que estás conectado al proyecto correcto antes de ejecutarlo manualmente en **Supabase → SQL Editor**. Para empezar con el nuevo flujo sin conservar los datos de prueba anteriores, ejecutalo únicamente en **EOD-dev**, después del esquema. Hacé antes un respaldo de los datos que quieras conservar. **No lo ejecutes en un proyecto cuyos datos deban mantenerse.**

## Generar datos de prueba

[`seed_test_visits.sql`](./seed_test_visits.sql) crea 50 predios y visitas por cada técnico existente. Con los tres técnicos de EOD-dev, genera 150 predios, asignaciones completadas y visitas. El administrador no recibe visitas; una cuenta admin se usa para cargar predios, asignarlos y registrar los pagos. Las visitas se distribuyen aleatoriamente de lunes a viernes, 10 por semana durante las cinco semanas completas previas a la semana actual. Las primeras 40 por técnico quedan abonadas en el viernes de su semana y las últimas 10 quedan impagas.

El script detecta las cuentas y roles directamente en el proyecto seleccionado. Solo se puede ejecutar si existe al menos un admin y un técnico, y las tablas `properties`, `visits` y `property_assignments` están vacías; está destinado al proyecto de pruebas, no a producción. Ejecutalo manualmente en **Supabase → SQL Editor** después de aplicar el esquema actualizado y verificar que estás conectado a EOD-dev. La transacción se revierte si falla alguna validación.

[`seed_current_week_visits.sql`](./seed_current_week_visits.sql) agrega predios, asignaciones y visitas de prueba para la semana actual sin borrar los registros existentes. Crea dos visitas por técnico por cada día hábil transcurrido de la semana (lunes a viernes), con fechas de Argentina y números de predio disponibles. Si ya pasó el viernes a las 18:00, marca ocho visitas por técnico como abonadas ese viernes. El script evita duplicar una carga de prueba de la misma semana y revierte todo si falla una validación. Ejecutalo manualmente en **Supabase → SQL Editor** después de confirmar que estás en EOD-dev; no lo uses en producción.

## Publicar con GitHub Pages

En GitHub, abrí **Settings → Pages**, seleccioná **Deploy from a branch**, elegí la rama `main` y la carpeta `/ (root)`, y guardá. GitHub Pages publica los archivos del repositorio; el acceso a los datos de la aplicación requiere iniciar sesión. Después de cambiar los archivos, publicá los cambios en el repositorio para que aparezcan en el sitio. Al publicar una versión nueva, actualizá el número de versión en `index.html`, `app.js` y `version.json`; así el navegador descarga los archivos actualizados y las sesiones abiertas en la pantalla de ingreso pueden refrescarse automáticamente.
