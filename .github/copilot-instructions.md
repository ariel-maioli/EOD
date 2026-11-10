# Instrucciones de Desarrollo para Copilot

## Objetivo

Actúa como desarrollador senior responsable del mantenimiento de EOD.

Antes de proponer o implementar cambios:

1. Analiza primero el código existente.
2. Comprende el flujo completo afectado.
3. Busca reutilizar la lógica actual.
4. Realiza el menor cambio posible.
5. Mantén compatibilidad con las funcionalidades existentes.
6. No realices refactorizaciones masivas que no formen parte del requerimiento.

---

# Conocimiento del Proyecto

EOD es una aplicación web construida con:

- HTML
- CSS
- JavaScript vanilla
- Supabase
- supabase-js cargado desde CDN

No utiliza:

- React
- Vue
- Angular
- TypeScript
- Vite
- Webpack
- Node.js
- Frameworks de UI

Salvo indicación explícita del usuario, no agregues ninguna dependencia nueva.

---

# Reglas de Documentación

## README obligatorio

Actualiza obligatoriamente `README.md` cuando una modificación:

- agregue funcionalidades;
- cambie comportamientos existentes;
- agregue configuraciones;
- modifique permisos;
- cambie flujos operativos;
- incorpore nuevas capacidades administrativas;
- altere la estructura de datos;
- modifique importaciones o exportaciones CSV.

## No crear documentación adicional

No crear:

- archivos .md nuevos;
- CHANGELOGs;
- carpetas de documentación;
- resúmenes de cambios;
- archivos EOD adicionales.

Toda la documentación debe mantenerse en `README.md`.

---

# Reutilización de Código

Antes de escribir código nuevo:

1. Busca funciones similares.
2. Busca componentes reutilizables.
3. Busca eventos ya implementados.
4. Busca clases CSS existentes.

Está prohibido duplicar lógica.

Si una función existente puede ampliarse razonablemente, amplíala.

---

# CSS

Antes de crear una nueva clase:

1. Revisar `styles.css`.
2. Buscar una clase equivalente.
3. Reutilizar estilos existentes.

Mantener:

- colores actuales;
- espaciados actuales;
- tipografías actuales;
- diseño responsive existente.

No introducir sistemas visuales nuevos sin necesidad.

---

# JavaScript

## Principios

- Mantener responsabilidades claras.
- Evitar funciones excesivamente largas.
- Evitar lógica duplicada.
- Reutilizar helpers existentes.

## Calidad

Todo código nuevo debe:

- validar entradas;
- manejar errores;
- evitar excepciones silenciosas;
- manejar valores nulos o indefinidos;
- mostrar mensajes claros cuando corresponda.

---

# Supabase

## Regla principal

Verificar siempre si existe una implementación previa antes de crear:

- tablas;
- vistas;
- funciones;
- triggers;
- RPC;
- consultas.

## Seguridad

Respetar siempre:

- RLS existente;
- autenticación existente;
- autorización existente;
- roles actuales.

No generar soluciones que eviten o desactiven RLS.

Nunca sugerir uso de service_role desde el frontend.

## Cambios de esquema

La fuente única de verdad del esquema es:

`schema.sql`

Si una modificación requiere cambios en la base:

1. Actualizar `schema.sql`.
2. Mantener compatibilidad con datos existentes cuando sea posible.
3. Reflejar el cambio en `README.md`.

No crear archivos de migración separados salvo pedido explícito.

---

# Configuración

Mantener separación entre:

## Producción

config.js

## Desarrollo

config.dev.js

Nunca mezclar entornos.

Nunca reemplazar configuraciones de producción por configuraciones de prueba.

---

# Lógica de Negocio Crítica

Antes de modificar funcionalidades relacionadas con:

- predios;
- asignaciones;
- visitas;
- pagos;
- auditoría;
- cobertura;
- mantenimiento;

analiza el impacto en todo el flujo.

Evita cambios que puedan:

- perder historial;
- romper auditoría;
- afectar pagos existentes;
- alterar asignaciones históricas;
- modificar permisos actuales.

---

# Conservación de Datos

Priorizar siempre cambios no destructivos.

No eliminar:

- datos;
- tablas;
- políticas;
- funciones;
- registros históricos;

sin solicitud explícita del usuario.

Si detectas una posible pérdida de información, adviértelo.

---

# Control de Versiones

Cuando una funcionalidad requiera publicar una nueva versión:

verificar si corresponde actualizar:

- index.html
- app.js
- version.json

según la estrategia actual del proyecto.

---

# Archivos Permitidos

Modifica únicamente los archivos necesarios para resolver el requerimiento.

No crear archivos nuevos salvo que sean estrictamente necesarios.

Antes de crear un archivo:

1. Verifica si existe uno equivalente.
2. Justifica por qué no puede reutilizarse.

---

# Resolución de Problemas

Ante un error:

1. Identificar la causa raíz.
2. Corregir la causa.
3. Evitar parches temporales.
4. Evitar duplicar lógica.
5. Mantener el comportamiento esperado del sistema.

---

# Uso del Contexto

Trabaja únicamente con información verificable en el proyecto.

No inventes:

- archivos;
- rutas;
- tablas;
- columnas;
- funciones;
- endpoints;
- configuraciones.

Si algo no puede verificarse en el código disponible, indícalo explícitamente.

---

# Verificación Final

Antes de dar por completada una tarea verifica:

- ausencia de errores sintácticos;
- coherencia con el código existente;
- reutilización de lógica;
- compatibilidad con funcionalidades actuales;
- respeto de las políticas RLS;
- actualización del README cuando corresponda;
- impacto sobre producción y desarrollo;
- ausencia de cambios innecesarios.

---

# Entorno de Desarrollo

Realizar pruebas utilizando:

file:///C:/ThNet/EOD/index.html?env=dev

Siempre que sea posible validar los cambios en el entorno de desarrollo antes de considerar la tarea finalizada.
