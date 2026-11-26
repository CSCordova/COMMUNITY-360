const guides = {
  topics: {
    purpose: 'Identificar qué temas reúnen más actividad y cuáles acumulan más reacciones recibidas.',
    calculation: 'Interacciones cuenta registros por tema. Reacciones recibidas suma el contador de reacciones de esos registros. Por ejemplo, 3 interacciones con 2, 5 y 0 reacciones suman 7 reacciones recibidas.',
    reading: 'Una barra más larga representa una cantidad mayor en la medida elegida. Las reacciones pueden proceder de la misma persona o tener distintos significados; la suma no mide satisfacción ni personas únicas.'
  },
  sentiment: {
    purpose: 'Comparar la puntuación media de sentimiento de los temas para orientar una revisión de sus registros.',
    calculation: 'Se suman las puntuaciones de sentimiento de las interacciones seleccionadas y se dividen entre su cantidad. Cada registro pesa lo mismo. La puntuación ya viene en los datos; esta aplicación no la obtiene analizando el texto.',
    reading: 'La escala va de −1 a +1. Por ejemplo, +0.60 y −0.12 tienen un promedio de +0.24. Un promedio de 0 puede mezclar valores positivos y negativos. No es un porcentaje de aprobación ni una medición de satisfacción.'
  },
  daily: {
    purpose: 'Localizar las fechas con más interacciones registradas y revisar los cambios de volumen.',
    calculation: 'Cada punto cuenta las interacciones de una fecha UTC que cumplen los filtros. Un mensaje, comentario, reacción, respuesta de encuesta o confirmación de evento cuenta como un registro.',
    reading: 'Un pico significa más registros ese día. No demuestra mayor calidad ni que una acción concreta haya causado el cambio. Los puntos corresponden a días con registros.'
  },
  reactions: {
    purpose: 'Identificar las interacciones de qué fechas acumulan más reacciones recibidas.',
    calculation: 'Se suman las reacciones recibidas de las interacciones creadas en cada fecha UTC. La fecha es la de la interacción que las recibió; no contamos cuándo ocurrió cada reacción porque no tenemos ese dato.',
    reading: 'Una columna alta indica más reacciones acumuladas en los registros de esa fecha. Cero puede coexistir con interacciones. La cantidad no indica si las reacciones fueron favorables.'
  },
  sentimentDaily: {
    purpose: 'Revisar cómo cambia la puntuación media de sentimiento entre las fechas seleccionadas.',
    calculation: 'Por cada fecha UTC, se suman las puntuaciones de sus interacciones y se dividen entre el número de registros de ese día. Los días sin registros no tienen promedio.',
    reading: 'La escala fija va de −1 a +1. El promedio usa la puntuación registrada en los datos; no es un porcentaje. Revisa la cantidad de registros de cada día antes de comparar: un único registro puede cambiar mucho un promedio.'
  },
  hours: {
    purpose: 'Localizar las franjas en las que se ha registrado más actividad durante el periodo seleccionado.',
    calculation: 'Cada celda cuenta interacciones con ese día de la semana y esa hora UTC, acumuladas en todo el periodo. Por ejemplo, lunes a las 08:00 reúne los registros entre las 08:00 y las 08:59 de todos los lunes seleccionados.',
    reading: 'Una celda más intensa representa más registros. Las columnas suman por hora o por día de la semana. Son totales observados, no promedios por día ni una predicción del mejor horario.'
  }
};

export default function MeasurementGuide({ measure }) {
  const guide = guides[measure];
  return <details className="measurement-guide"><summary>Qué mide y para qué sirve</summary><dl>
    <div><dt>Objetivo</dt><dd>{guide.purpose}</dd></div>
    <div><dt>Cómo se calcula</dt><dd>{guide.calculation}</dd></div>
    <div><dt>Cómo interpretarlo</dt><dd>{guide.reading}</dd></div>
  </dl></details>;
}
