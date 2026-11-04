# EOD

Aplicación web para registrar y consultar visitas de mantenimiento a predios. La interfaz está hecha con HTML, CSS y JavaScript: no requiere compilación ni instalación de herramientas. Usa `supabase-js` desde un CDN y Supabase para autenticación y datos, por lo que necesita conexión a internet.

## Configuración de Supabase

1. Creá un proyecto Supabase.
2. En **SQL Editor**, ejecutá el contenido completo de [`schema.sql`](./schema.sql). Es el esquema completo de EOD: crea o actualiza las tablas, índices, funciones, triggers, permisos y políticas RLS. Para una instalación nueva, ejecutalo antes de conectar la aplicación.
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

6. En **Authentication → URL Configuration**, configurá **Site URL** con la URL publicada, por ejemplo `https://ariel-maioli.github.io/EOD/`, y agregala también a **Redirect URLs**. Los enlaces de recuperación deben volver a la aplicación publicada.
7. El usuario puede seleccionar **Olvidé mi contraseña** en el inicio de sesión. El administrador también puede enviar un enlace desde **Authentication → Users**. El enlace permite elegir una contraseña nueva en EOD.

## Actualizar un proyecto Supabase existente

Ejecutá el contenido completo de [`schema.sql`](./schema.sql) en **SQL Editor** para actualizar un proyecto EOD existente. El archivo incluye todas las definiciones actuales: nombres visibles, permisos de edición, seguimiento y privacidad de pagos, y bloqueo de fechas futuras. Crea o actualiza objetos y políticas; no borra visitas, predios, perfiles ni auditoría. Usá el script del proyecto correcto y no lo confundas con [`clear_production_visits.sql`](./clear_production_visits.sql), que sí es destructivo.

No necesitás ejecutar scripts de migración separados: `schema.sql` es la fuente única del esquema vigente. Después, en **Table Editor → profiles**, completá `display_name` para mostrar nombres en lugar de correos; si queda vacío, la aplicación usa el correo como alternativa.

## Roles y uso de la aplicación

- **Técnicos:** pueden registrar visitas y editar las visitas activas que registraron ellos mismos.
- **Administrador:** puede editar visitas de cualquier técnico, archivar y restaurar visitas o predios, procesar y corregir pagos, consultar actividad y exportar CSV.
- Los datos se vuelven a cargar al entrar en cada sección. Al actualizar la página, la sesión existente se restaura y se vuelven a cargar los datos.
- El saludo cambia según la hora de Argentina: «Buenos días» (05:00–11:59), «Buenas tardes» (12:00–19:59) y «Buenas noches» (20:00–04:59).

## Registrar visitas

- El número de predio debe tener seis dígitos, comenzar entre 1 y 9, y no puede estar vacío.
- La fecha se propone inicialmente como hoy y no se permiten fechas futuras, tampoco al editar.
- El contacto es obligatorio (hasta 50 caracteres); el celular es obligatorio y debe tener 10 dígitos, sin prefijo `0` ni `15`; las notas son opcionales (hasta 250 caracteres).
- Solo puede existir una visita por predio y fecha.
- No se puede registrar una visita mientras el predio esté archivado. El administrador debe restaurar el predio primero.
- Tras guardar, la confirmación aparece dentro del formulario y desaparece al empezar a escribir el registro siguiente o después de 4,5 segundos. El foco vuelve al número de predio para facilitar la carga consecutiva. Los errores se anuncian y la pantalla se desplaza hasta el mensaje.

## Buscar visitas

La búsqueda admite número de predio, nombre de contacto o celular y filtros por fecha. Los resultados se ordenan por fecha de visita descendente; si coinciden, se prioriza el registro más reciente.

- **Técnicos:** en la pantalla de búsqueda, la aplicación muestra solo predios activos y los datos básicos de cada visita: número, fecha, contacto y celular. No tienen filtros por técnico ni por estado. Cada fila permite abrir WhatsApp para el número argentino o copiar el celular. Esta limitación de campos corresponde a la interfaz; no implica que todas las demás columnas estén restringidas en la API de Supabase.
- **Administrador:** conserva acceso a visitas activas y archivadas, ve los detalles y acciones administrativas, y puede filtrar por técnico y estado.
- El administrador puede exportar a CSV los resultados filtrados o los registros activos. La opción **Exportar todos los activos** fuerza el estado activo, pero conserva la búsqueda, los filtros de fecha y el filtro de técnico actuales. El archivo usa `;` como separador.

Archivar un predio no cambia el estado individual de sus visitas, pero las oculta mientras el predio permanezca archivado. Al restaurar el predio, vuelven a aparecer las visitas que no se archivaron por separado. Archivar una visita afecta solo a esa visita.

## Pagos

Solo el administrador puede procesar pagos. Se ingresan números de predio separados por coma; se marca como abonada la visita activa más reciente de cada predio y se registra la fecha del proceso y quién lo realizó. Si un predio no existe, está archivado, no tiene visitas activas o la visita ya está abonada, la aplicación informa el motivo y permite decidir si continúa con los siguientes números. Las correcciones del pago solo están disponibles para el admin y quedan registradas en la auditoría.

En la sección **Pagos** se muestran las últimas 15 visitas abonadas, ordenadas por fecha de proceso descendente. Cada fila incluye número de predio, técnico que registró la visita y fecha de proceso. Los técnicos solo ven pagos de sus propias visitas; el administrador puede ver todos.

## Actividad reciente

Solo el administrador tiene acceso a esta sección. Muestra los eventos de auditoría de los últimos 30 días, con un máximo de 500 eventos por carga. Los nombres de usuario, predios, fechas y acciones se presentan en forma legible. La base conserva el historial sin purgarlo automáticamente, salvo cuando se ejecuta el script de limpieza.

## Limpiar datos de producción

[`clear_production_visits.sql`](./clear_production_visits.sql) es destructivo: elimina todas las visitas, todos los predios y todo el historial de auditoría; conserva las cuentas de Supabase Auth y `public.profiles`. El script bloquea las tablas durante la operación, desactiva temporalmente los triggers necesarios y utiliza una transacción para revertir los cambios si ocurre un error.

Revisá el contenido y verificá que estás conectado al proyecto correcto antes de ejecutarlo manualmente en **Supabase → SQL Editor**. Hacé antes un respaldo de los datos que quieras conservar. **No lo ejecutes en un proyecto cuyos datos deban mantenerse.**

## Generar datos de prueba

[`seed_test_visits.sql`](./seed_test_visits.sql) crea 200 visitas y 200 predios para probar la aplicación: 50 visitas por cada uno de cuatro técnicos. El administrador no recibe visitas; su cuenta solo se usa para registrar los pagos. Las visitas se distribuyen aleatoriamente de lunes a viernes, 10 por semana durante cinco semanas desde el 13 de abril de 2026. Las primeras 40 por técnico quedan abonadas en el viernes de su semana y las últimas 10 quedan impagas.

El script contiene los UUID de las cuentas de prueba y verifica que existan con los roles esperados. Solo se puede ejecutar si las tablas `properties` y `visits` están vacías; está destinado al proyecto nuevo de pruebas, no a producción. Ejecutalo manualmente en **Supabase → SQL Editor** después de crear las cuentas y configurar sus roles. La transacción se revierte si falla alguna validación.

## Publicar con GitHub Pages

En GitHub, abrí **Settings → Pages**, seleccioná **Deploy from a branch**, elegí la rama `main` y la carpeta `/ (root)`, y guardá. GitHub Pages publica los archivos del repositorio; el acceso a los datos de la aplicación requiere iniciar sesión. Después de cambiar los archivos, publicá los cambios en el repositorio para que aparezcan en el sitio.
