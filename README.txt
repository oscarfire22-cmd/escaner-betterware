ESCÁNER BETTERWARE V10

ESTRUCTURA DEL PROYECTO
- public/: archivos de la aplicación web (index.html, manifest.webmanifest, sw.js)
- netlify/functions/betterware-product.mjs: consulta del catálogo oficial Betterware desde servidor
- netlify.toml: indica a Netlify dónde están los archivos públicos y la función

CAMBIOS
1. Registro: código, nombre, descripción, piezas disponibles, costo opcional, precio de venta, precio regular Betterware y precio promocional/condiciones.
2. La cantidad de piezas se guarda en el catálogo local, se puede editar y aparece en el catálogo. Los productos existentes reciben cantidad 0 sin borrar sus datos.
3. CSV incluye piezas_disponibles; CSV anteriores sin esa columna importan cantidad 0.
4. Verificar en Betterware: después de leer el código navega directamente a la búsqueda oficial, conservando pws=veromedina.
5. Registrar: al leer un SKU nuevo consulta la función de Netlify para completar nombre, descripción e información de precios si la ficha oficial devuelve esos datos.
6. Se conserva localStorage key betterware_catalog_v1. No borres datos del navegador.

IMPORTANTE SOBRE LA PUBLICACIÓN
El despliegue actual detectado en Netlify fue de tipo manual/drop y reporta “No functions deployed”. Arrastrar solamente index.html o el contenido de public NO publica la función. Por eso el autocompletado no podía funcionar en la V9.

Para activar el autocompletado, publica ESTE PROYECTO COMPLETO conectado a un repositorio Git (GitHub/GitLab) o mediante Netlify CLI desde una computadora con Node.js y Netlify CLI. Netlify debe leer netlify.toml y desplegar la función betterware-product.

Comando con Netlify CLI, ejecutado desde la carpeta raíz del proyecto:
  netlify deploy --prod

No uses el botón de arrastrar y soltar para publicar únicamente public/: eso deja fuera la función. Tras desplegar, en Netlify > Functions debe aparecer betterware-product. La URL de prueba es:
  /.netlify/functions/betterware-product?sku=SKU

La consulta requiere internet y depende de que Betterware mantenga disponible su búsqueda pública y exponga el SKU/barcode en los resultados. Si no hay coincidencia exacta, la función devuelve un error en vez de rellenar con un producto incorrecto.

PRUEBAS REALIZADAS EN ESTE PAQUETE
- Sintaxis JavaScript del frontend y función.
- Integridad del ZIP.
- Revisión estática de que quantity se guarda, edita, muestra, exporta e importa.

Pendiente de prueba real: cámara en Android y respuesta actual de Betterware después de publicar la función.
