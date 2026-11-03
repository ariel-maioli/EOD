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

## Publicar con GitHub Pages

En GitHub, abrí **Settings → Pages**, seleccioná **Deploy from a branch**, elegí `main` y la carpeta `/ (root)`, y guardá. La URL pública servirá los archivos de este repositorio; para usar los datos se requiere iniciar sesión.

## Funciones incluidas

- Inicio de sesión por correo y contraseña. El administrador gestiona cuentas y restablece claves desde Supabase.
- Alta de visitas y edición de visitas activas.
- Búsqueda por número de predio, nombre o celular; filtros por fechas, técnico y estado.
- Archivo y restauración de visitas/predios, solo para el administrador.
- Actividad de auditoría de los últimos 30 días en la pantalla del administrador. La base conserva el historial sin purgarlo automáticamente.
- Exportación CSV para el administrador: resultados filtrados o todos los registros activos.

La aplicación aplica el límite de una visita por predio y fecha y valida los campos también en la base de datos. Para mantener la configuración actualizada, volvé a publicar cualquier cambio en estos archivos.
