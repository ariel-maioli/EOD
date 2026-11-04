# EOD

Aplicación web sencilla para registrar visitas de mantenimiento a predios. La interfaz usa HTML, CSS y JavaScript sin proceso de compilación ni instalación; carga `supabase-js` desde CDN para autenticarse y comunicarse con Supabase.

## Conectar con Supabase

1. Creá un proyecto Supabase.
2. En **SQL Editor**, ejecutá el contenido completo de [`schema.sql`](./schema.sql).
3. En **Authentication**, desactivá el registro público y creá/invitá las cuentas de los técnicos.
4. Una vez creada la cuenta del administrador, ejecutá en SQL Editor:

   ```sql
   UPDATE public.profiles
   SET role = 'admin'
   WHERE lower(email) = lower('correo-del-admin@example.com');
   ```

5. En **Project Settings → API**, copiá la URL del proyecto y la clave pública (anon/publishable) en [`config.js`](./config.js):

   ```js
   window.EOD_CONFIG = Object.freeze({
     supabaseUrl: "https://TU-PROYECTO.supabase.co",
     supabaseAnonKey: "TU-CLAVE-PUBLICA"
   });
   ```

   La clave pública está pensada para estar disponible en el navegador; el acceso a los datos lo limitan las políticas RLS definidas por el esquema. **Nunca uses ni publiques la clave `service_role` o una clave secreta.**

6. En **Authentication → URL Configuration**, configurá **Site URL** como la URL publicada, por ejemplo `https://ariel-maioli.github.io/EOD/`, y agregá esa misma dirección a **Redirect URLs**. Los enlaces de recuperación deben volver a la aplicación publicada, no a `localhost`.
7. El usuario puede elegir **Olvidé mi contraseña** en el inicio de sesión. El administrador también puede enviar un enlace de recuperación desde **Authentication → Users**. El enlace abre el formulario de cambio de contraseña en EOD.

## Nombres visibles de usuarios

Para un proyecto que ya ejecutó el esquema inicial, ejecutá [`profile_display_name.sql`](./profile_display_name.sql) en **SQL Editor**. Luego, en **Table Editor → profiles**, completá `display_name` para cada usuario. El nombre se muestra en la aplicación, la actividad y las exportaciones; el correo sigue siendo el identificador de inicio de sesión y se muestra como alternativa si el nombre está vacío.

## Permisos de edición de visitas

Para un proyecto que ya ejecutó el esquema anterior, ejecutá [`visit_edit_permissions.sql`](./visit_edit_permissions.sql) en **SQL Editor**. Desde entonces, cada técnico puede editar solo sus visitas activas; el administrador conserva permiso para editar cualquier visita. La regla se valida tanto en la interfaz como en las políticas de la base de datos.

## Pagos

Para un proyecto que ya ejecutó el esquema anterior, ejecutá [`visit_payments.sql`](./visit_payments.sql) en **SQL Editor**. Solo el administrador puede procesar listas de predios separados por coma; se marca la visita activa más reciente y se registra la fecha y quién realizó el proceso. Todos los usuarios autenticados pueden consultar el estado y la fecha de pago. Si un predio no existe, está archivado, no tiene visitas activas o la visita ya está abonada, la app informa el motivo y pregunta si continúa con los siguientes números. Las correcciones del pago están disponibles únicamente para el admin y quedan auditadas.

## Preparar producción para el inicio

Cuando estés listo para eliminar los datos de la aplicación, revisá [`clear_production_visits.sql`](./clear_production_visits.sql) y ejecutalo manualmente en **Supabase → SQL Editor**. Es una operación destructiva: borra todas las visitas, todos los predios y todo el historial de auditoría; conserva los usuarios de Supabase y sus perfiles. La transacción bloquea temporalmente las tablas y revierte todo si ocurre un error. No lo ejecutes en un proyecto que quieras conservar sin antes verificar que sea el proyecto correcto y respaldar los datos necesarios.

## Publicar con GitHub Pages

En GitHub, abrí **Settings → Pages**, seleccioná **Deploy from a branch**, elegí `main` y la carpeta `/ (root)`, y guardá. La URL pública servirá los archivos de este repositorio; para usar los datos se requiere iniciar sesión.

## Funciones incluidas

- Inicio de sesión por correo y contraseña. El administrador gestiona cuentas y restablece claves desde Supabase.
- Alta de visitas y edición de visitas activas.
- Búsqueda por número de predio, nombre o celular; filtros por fechas, técnico y estado.
- Archivo y restauración de visitas/predios, solo para el administrador.
- Estado de pago y fecha en las visitas; el administrador puede marcar/corregir pagos desde la sección Pagos.
- Actividad de auditoría de los últimos 30 días en la pantalla del administrador. La base conserva el historial sin purgarlo automáticamente.
- Exportación CSV para el administrador: resultados filtrados o todos los registros activos.

La aplicación aplica el límite de una visita por predio y fecha y valida los campos también en la base de datos. Para mantener la configuración actualizada, volvé a publicar cualquier cambio en estos archivos.
