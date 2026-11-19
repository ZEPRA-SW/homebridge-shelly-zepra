'use strict';
// Stable German source keys also translate saved protocol messages without altering storage.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./i18n'));else factory(root.ZepraI18n);})(typeof window==='object'?window:globalThis,I=>{
 const rows=[
 ["Taupunkt", "Dew point", "Point de rosée", "Punto de rocío"],
 ["Temperaturquelle", "Temperature source", "Source de température", "Fuente de temperatura"],
 ["Luftfeuchtequelle", "Humidity source", "Source d’humidité", "Fuente de humedad"],
 ["Taupunktgrenze (°C)", "Dew-point threshold (°C)", "Seuil du point de rosée (°C)", "Umbral del punto de rocío (°C)"],
 ["Berechneter Taupunkt: {value} °C", "Calculated dew point: {value} °C", "Point de rosée calculé : {value} °C", "Punto de rocío calculado: {value} °C"],
 ["Keine aktuellen Taupunktdaten verfügbar.", "No current dew-point data available.", "Aucune donnée actuelle de point de rosée disponible.", "No hay datos actuales del punto de rocío."],
 ["Taupunkt über Wasser nach Magnus. Temperatur und Luftfeuchte müssen dieselbe Luft beschreiben. Bereich: −45 bis 60 °C und über 0 bis 100 % relative Feuchte. Fehlende, fehlerhafte oder veraltete Werte lösen nichts aus.", "Dew point over water using Magnus. Temperature and humidity must describe the same air. Range: −45 to 60 °C and relative humidity above 0 up to 100%. Missing, faulty or stale readings do not trigger actions.", "Point de rosée sur eau selon Magnus. La température et l’humidité doivent décrire le même air. Plage : −45 à 60 °C et humidité relative supérieure à 0 jusqu’à 100 %. Les valeurs absentes, erronées ou périmées ne déclenchent aucune action.", "Punto de rocío sobre agua según Magnus. La temperatura y la humedad deben describir el mismo aire. Rango: −45 a 60 °C y humedad relativa superior a 0 hasta el 100 %. Los valores ausentes, erróneos o desactualizados no activan acciones."],
 ["Scene: Taupunkt benötigt eine Temperatur- und eine Luftfeuchtequelle.", "Scene: dew point requires a temperature source and a humidity source.", "Scene : le point de rosée nécessite une source de température et une source d’humidité.", "Scene: el punto de rocío requiere una fuente de temperatura y una fuente de humedad."],
 ["Analogwert","Analog value","Valeur analogique","Valor analógico"],
 [
  "Aus",
  "Off",
  "Désactivée",
  "Desactivada"
 ],
 [
  "Ein",
  "On",
  "Activé",
  "Activado"
 ],
 [
  "aktiv",
  "active",
  "actif",
  "activo"
 ],
 [
  "inaktiv",
  "inactive",
  "inactif",
  "inactivo"
 ],
 [
  "geschlossen",
  "closed",
  "fermé",
  "cerrado"
 ],
 [
  "offen",
  "open",
  "ouvert",
  "abierto"
 ],
 [
  "true",
  "true",
  "vrai",
  "verdadero"
 ],
 [
  "false",
  "false",
  "faux",
  "falso"
 ],
 [
  "Immer aktiv",
  "Always active",
  "Toujours active",
  "Siempre activa"
 ],
 [
  "Zeitplan",
  "Schedule",
  "Planification",
  "Horario"
 ],
 [
  "Nach Zeitplan",
  "Scheduled",
  "Selon la planification",
  "Según horario"
 ],
 [
  "Name der Scene",
  "Scene name",
  "Nom de la scène",
  "Nombre de la escena"
 ],
 [
  "Betriebsart",
  "Mode",
  "Mode",
  "Modo"
 ],
 [
  "Neue Scene",
  "New Scene",
  "Nouvelle scène",
  "Nueva escena"
 ],
 [
  "Scene entfernen",
  "Remove Scene",
  "Supprimer la scène",
  "Eliminar escena"
 ],
 [
  "Gewünschter Wert",
  "Desired value",
  "Valeur souhaitée",
  "Valor deseado"
 ],
 [
  "Bewegung",
  "Motion",
  "Mouvement",
  "Movimiento"
 ],
 [
  "Keine Bewegung",
  "No motion",
  "Aucun mouvement",
  "Sin movimiento"
 ],
 [
  "Ein / Aktiv",
  "On / Active",
  "Activé / Actif",
  "Encendido / Activo"
 ],
 [
  "Aus / Inaktiv",
  "Off / Inactive",
  "Désactivé / Inactif",
  "Apagado / Inactivo"
 ],
 [
  "Kontaktzustand",
  "Contact state",
  "État du contact",
  "Estado del contacto"
 ],
 [
  "Geschlossen",
  "Closed",
  "Fermé",
  "Cerrado"
 ],
 [
  "Offen",
  "Open",
  "Ouvert",
  "Abierto"
 ],
 [
  "Wert",
  "Value",
  "Valeur",
  "Valor"
 ],
 [
  "So",
  "Sun",
  "Dim",
  "Dom"
 ],
 [
  "Mo",
  "Mon",
  "Lun",
  "Lun"
 ],
 [
  "Di",
  "Tue",
  "Mar",
  "Mar"
 ],
 [
  "Mi",
  "Wed",
  "Mer",
  "Mié"
 ],
 [
  "Do",
  "Thu",
  "Jeu",
  "Jue"
 ],
 [
  "Fr",
  "Fri",
  "Ven",
  "Vie"
 ],
 [
  "Sa",
  "Sat",
  "Sam",
  "Sáb"
 ],
 [
  "UND",
  "AND",
  "ET",
  "Y"
 ],
 [
  "ODER",
  "OR",
  "OU",
  "O"
 ],
 [
  "{operator} · {count} Bedingung",
  "{operator} · {count} condition",
  "{operator} · {count} condition",
  "{operator} · {count} condición"
 ],
 [
  "{operator} · {count} Bedingungen",
  "{operator} · {count} conditions",
  "{operator} · {count} conditions",
  "{operator} · {count} condiciones"
 ],
 [
  "Zeit · {time}",
  "Time · {time}",
  "Heure · {time}",
  "Hora · {time}"
 ],
 [
  "Uhrzeit wählen",
  "Choose time",
  "Choisir une heure",
  "Elegir hora"
 ],
 [
  "Shelly wählen",
  "Choose Shelly",
  "Choisir un Shelly",
  "Elegir Shelly"
 ],
 [
  "Zustand / Wert wählen",
  "Choose state / value",
  "Choisir un état / une valeur",
  "Elegir estado / valor"
 ],
 [
  " · {seconds} s",
  " · {seconds} s",
  " · {seconds} s",
  " · {seconds} s"
 ],
 [
  "Beschattung",
  "Shading",
  "Protection solaire",
  "Protección solar"
 ],
 [
  "Bitte Shelly auswählen",
  "Please select a Shelly",
  "Sélectionnez un Shelly",
  "Seleccione un Shelly"
 ],
 [
  "Gespeichertes Shelly – nicht mehr vorhanden",
  "Saved Shelly – no longer available",
  "Shelly enregistré – n’existe plus",
  "Shelly guardado: ya no está disponible"
 ],
 [
  "Quelle – Shelly",
  "Source – Shelly",
  "Source – Shelly",
  "Origen: Shelly"
 ],
 [
  "Bedingungsart",
  "Condition type",
  "Type de condition",
  "Tipo de condición"
 ],
 [
  "Status",
  "State",
  "État",
  "Estado"
 ],
 [
  "Zeit",
  "Time",
  "Heure",
  "Hora"
 ],
 [
  "Uhrzeit",
  "Time",
  "Heure",
  "Hora"
 ],
 [
  "Wochentage",
  "Days of the week",
  "Jours de la semaine",
  "Días de la semana"
 ],
 [
  "Bitte Zustand oder Sensorwert auswählen",
  "Please select a state or sensor value",
  "Sélectionnez un état ou une valeur de capteur",
  "Seleccione un estado o valor de sensor"
 ],
 [
  "Zuerst Shelly auswählen",
  "Select a Shelly first",
  "Sélectionnez d’abord un Shelly",
  "Seleccione primero un Shelly"
 ],
 [
  "Gespeicherter Zustand / Wert – aktuell keine Daten",
  "Saved state / value – no current data",
  "État / valeur enregistré – aucune donnée actuelle",
  "Estado / valor guardado: sin datos actuales"
 ],
 [
  "Zustand / Sensor",
  "State / Sensor",
  "État / Capteur",
  "Estado / Sensor"
 ],
 [
  "Messwert / Sensor",
  "Measurement / Sensor",
  "Mesure / Capteur",
  "Medición / Sensor"
 ],
 [
  "Hier erscheinen nur Zustände und Sensoren des gewählten Shellys. BTHome-IDs bleiben zur Zuordnung sichtbar.",
  "Only states and sensors of the selected Shelly appear here. BTHome IDs remain visible for identification.",
  "Seuls les états et capteurs du Shelly sélectionné apparaissent ici. Les identifiants BTHome restent visibles pour les reconnaître.",
  "Aquí solo aparecen estados y sensores del Shelly seleccionado. Los ID BTHome siguen visibles para identificarlos."
 ],
 [
  "Vergleich",
  "Comparison",
  "Comparaison",
  "Comparación"
 ],
 [
  "ist gleich",
  "equals",
  "est égal à",
  "es igual a"
 ],
 [
  "ist ungleich",
  "does not equal",
  "est différent de",
  "es distinto de"
 ],
 [
  "größer als",
  "greater than",
  "est supérieur à",
  "es mayor que"
 ],
 [
  "größer oder gleich",
  "greater than or equal to",
  "est supérieur ou égal à",
  "es mayor o igual que"
 ],
 [
  "kleiner als",
  "less than",
  "est inférieur à",
  "es menor que"
 ],
 [
  "kleiner oder gleich",
  "less than or equal to",
  "est inférieur ou égal à",
  "es menor o igual que"
 ],
 [
  "Bedingung muss erfüllt sein (Sekunden)",
  "Condition must hold for (seconds)",
  "Durée de maintien de la condition (secondes)",
  "La condición debe cumplirse durante (segundos)"
 ],
 [
  "0 = ohne zusätzliche Bestätigungsdauer. Unterbrechungen oder fehlende Daten setzen die Dauer zurück. Nach Ablauf ist eine aktuelle Bestätigung nötig; das Statusintervall kann die Auslösung verzögern.",
  "0 = no extra confirmation period. Interruptions or missing data reset the period. A current confirmation is required afterwards; the status interval may delay the trigger.",
  "0 = aucune durée de confirmation supplémentaire. Les interruptions ou données manquantes remettent la durée à zéro. Une confirmation actuelle est ensuite nécessaire ; l’intervalle d’état peut retarder le déclenchement.",
  "0 = sin período adicional de confirmación. Las interrupciones o la falta de datos reinician el período. Después se requiere una confirmación actual; el intervalo de estado puede retrasar la activación."
 ],
 [
  "Hysterese",
  "Hysteresis",
  "Hystérésis",
  "Histéresis"
 ],
 [
  "Abstand zur Rücksetzgrenze, in derselben Einheit wie der Messwert. Verhindert häufiges Umschalten nahe der Schwelle.",
  "Distance to the reset threshold, in the same unit as the measurement. Prevents frequent switching near the threshold.",
  "Écart par rapport au seuil de réinitialisation, dans la même unité que la mesure. Évite les commutations fréquentes près du seuil.",
  "Distancia al umbral de restablecimiento, en la misma unidad que la medición. Evita cambios frecuentes cerca del umbral."
 ],
 [
  "Verknüpfung",
  "Logic",
  "Opérateur logique",
  "Operador lógico"
 ],
 [
  "UND – alle Bedingungen",
  "AND – all conditions",
  "ET – toutes les conditions",
  "Y: todas las condiciones"
 ],
 [
  "ODER – mindestens eine Bedingung",
  "OR – at least one condition",
  "OU – au moins une condition",
  "O: al menos una condición"
 ],
 [
  "Bedingung nach oben",
  "Move condition up",
  "Monter la condition",
  "Subir condición"
 ],
 [
  "Bedingung nach unten",
  "Move condition down",
  "Descendre la condition",
  "Bajar condición"
 ],
 [
  "Bedingung entfernen",
  "Remove condition",
  "Supprimer la condition",
  "Eliminar condición"
 ],
 [
  "Bedingung hinzufügen",
  "Add condition",
  "Ajouter une condition",
  "Añadir condición"
 ],
 [
  "Gruppe hinzufügen",
  "Add group",
  "Ajouter un groupe",
  "Añadir grupo"
 ],
 [
  "Weiter zur Aktion",
  "Continue to action",
  "Passer à l’action",
  "Continuar a la acción"
 ],
 [
  "Startbedingungen einklappen und zu den Aktionsstufen springen",
  "Collapse start conditions and jump to action stages",
  "Replier les conditions de départ et aller aux étapes d’action",
  "Contraer las condiciones iniciales e ir a las etapas de acción"
 ],
 [
  "Als UND-/ODER-Gruppe erweitern",
  "Expand into an AND/OR group",
  "Développer en groupe ET/OU",
  "Ampliar a un grupo Y/O"
 ],
 [
  "Bei Rücksetzen der Bedingung vorherigen Zustand wiederherstellen",
  "Restore previous state when the condition resets",
  "Rétablir l’état précédent lorsque la condition cesse d’être remplie",
  "Restaurar el estado anterior cuando deje de cumplirse la condición"
 ],
 [
  "Mit Haken werden vor dem ersten Befehl die Ausgangswerte gespeichert. Sobald der gesamte Startbedingungsbaum wieder falsch ist, werden eigene Änderungen zurückgenommen. Fehlende Daten lösen keine Rücksetzung aus. Zeitbedingungen werden nach ihrer Trefferminute falsch.",
  "When checked, original values are saved before the first command. Once the entire start-condition tree becomes false again, the Scene’s changes are undone. Missing data does not trigger a reset. Time conditions become false after their matching minute.",
  "Si cette option est cochée, les valeurs initiales sont enregistrées avant la première commande. Dès que l’ensemble de l’arbre de départ devient à nouveau faux, les modifications de la scène sont annulées. Les données manquantes ne déclenchent aucune réinitialisation. Les conditions horaires deviennent fausses après la minute correspondante.",
  "Si está marcada, se guardan los valores originales antes de la primera orden. Cuando todo el árbol de condiciones iniciales vuelva a ser falso, se deshacen los cambios de la escena. La falta de datos no provoca un restablecimiento. Las condiciones horarias pasan a ser falsas tras el minuto indicado."
 ],
 [
  "Aktivierungszeitplan",
  "Activation schedule",
  "Planification d’activation",
  "Horario de activación"
 ],
 [
  "Beginn",
  "Start",
  "Début",
  "Inicio"
 ],
 [
  "Ende",
  "End",
  "Fin",
  "Fin"
 ],
 [
  "Zeitzone: {timeZone}. Zeitfenster können über Mitternacht gehen. Der Wochentag gehört zum Beginn. Außerhalb des Fensters wird nichts nachgeholt.",
  "Time zone: {timeZone}. Time windows may cross midnight. The weekday refers to the start. Nothing is caught up outside the window.",
  "Fuseau horaire : {timeZone}. Les plages peuvent passer minuit. Le jour correspond au début. Aucun rattrapage n’a lieu hors de la plage.",
  "Zona horaria: {timeZone}. Los intervalos pueden pasar de medianoche. El día corresponde al inicio. Fuera del intervalo no se recuperan acciones pendientes."
 ],
 [
  "Startbedingungen",
  "Start conditions",
  "Conditions de départ",
  "Condiciones iniciales"
 ],
 [
  "UND: alle Bedingungen. ODER: mindestens eine Bedingung. Bei 0 Sekunden ist der erste Status nach dem Start der Ausgangszustand; eine positive Dauer verlangt eine aktuelle Bestätigung. Zeitbedingungen gelten in der angegebenen Minute, höchstens einmal je Tag und Zeitzweig.",
  "AND: all conditions. OR: at least one condition. With 0 seconds, the first state after startup is the baseline; a positive duration requires a current confirmation. Time conditions apply during the specified minute, at most once per day and time branch.",
  "ET : toutes les conditions. OU : au moins une condition. À 0 seconde, le premier état après le démarrage sert de référence ; une durée positive exige une confirmation actuelle. Les conditions horaires s’appliquent durant la minute indiquée, au plus une fois par jour et par branche horaire.",
  "Y: todas las condiciones. O: al menos una condición. Con 0 segundos, el primer estado tras el inicio sirve de referencia; una duración positiva requiere confirmación actual. Las condiciones horarias se aplican durante el minuto indicado, como máximo una vez al día y por rama horaria."
 ],
 [
  "Stufe {step}",
  "Stage {step}",
  "Étape {step}",
  "Etapa {step}"
 ],
 [
  " · {seconds} s warten",
  " · wait {seconds} s",
  " · attendre {seconds} s",
  " · esperar {seconds} s"
 ],
 [
  " · Bedingungen",
  " · conditions",
  " · conditions",
  " · condiciones"
 ],
 [
  "Aktion wählen",
  "Choose action",
  "Choisir une action",
  "Elegir acción"
 ],
 [
  "Aktion {step}",
  "Action {step}",
  "Action {step}",
  "Acción {step}"
 ],
 [
  "Aktion {step} nach oben",
  "Move action {step} up",
  "Monter l’action {step}",
  "Subir acción {step}"
 ],
 [
  "Aktion {step} nach unten",
  "Move action {step} down",
  "Descendre l’action {step}",
  "Bajar acción {step}"
 ],
 [
  "Aktion entfernen",
  "Remove action",
  "Supprimer l’action",
  "Eliminar acción"
 ],
 [
  "Bitte Ziel und Funktion auswählen",
  "Please select target and function",
  "Sélectionnez une cible et une fonction",
  "Seleccione destino y función"
 ],
 [
  "Gespeichertes Ziel – nicht verfügbar",
  "Saved target – unavailable",
  "Cible enregistrée – indisponible",
  "Destino guardado: no disponible"
 ],
 [
  "Wartezeit davor (Sekunden)",
  "Wait before this action (seconds)",
  "Attente avant cette action (secondes)",
  "Espera antes de esta acción (segundos)"
 ],
 [
  "Zuerst diese feste Wartezeit, dann optionale Zwischenbedingungen, dann die Aktion. Bei späteren Stufen beginnt sie nach Annahme des vorherigen Befehls.",
  "First this fixed wait, then optional intermediate conditions, then the action. In later stages, the wait starts after the preceding command is accepted.",
  "D’abord cette attente fixe, puis les éventuelles conditions intermédiaires, puis l’action. Pour les étapes suivantes, l’attente commence après l’acceptation de la commande précédente.",
  "Primero esta espera fija, luego las condiciones intermedias opcionales y después la acción. En etapas posteriores, la espera comienza cuando se acepta la orden anterior."
 ],
 [
  "Zielgerät und Funktion",
  "Target device and function",
  "Appareil cible et fonction",
  "Dispositivo de destino y función"
 ],
 [
  "Vor dieser Aktion: auf Bedingungen warten",
  "Before this action: wait for conditions",
  "Avant cette action : attendre les conditions",
  "Antes de esta acción: esperar condiciones"
 ],
 [
  "Maximale Bedingungswartezeit (Sekunden)",
  "Maximum condition wait (seconds)",
  "Attente maximale des conditions (secondes)",
  "Espera máxima de condiciones (segundos)"
 ],
 [
  "Ab Beginn dieser Bedingungsstufe. Sensorwerte müssen danach frisch bestätigt werden. Bei Zeitüberschreitung wird die Scene abgebrochen.",
  "Measured from the start of this condition stage. Sensor values must be confirmed again afterwards. The Scene is aborted if the time limit is exceeded.",
  "Mesurée depuis le début de cette étape de conditions. Les valeurs des capteurs doivent ensuite être confirmées de nouveau. La scène est interrompue si le délai est dépassé.",
  "Se mide desde el inicio de esta etapa de condiciones. Los valores de los sensores deben confirmarse de nuevo después. La escena se interrumpe si se supera el tiempo límite."
 ],
 [
  "Zwischenbedingung entfernen",
  "Remove intermediate condition",
  "Supprimer la condition intermédiaire",
  "Eliminar condición intermedia"
 ],
 [
  "Zwischenbedingung hinzufügen",
  "Add intermediate condition",
  "Ajouter une condition intermédiaire",
  "Añadir condición intermedia"
 ],
 [
  "Stufe hinzufügen",
  "Add stage",
  "Ajouter une étape",
  "Añadir etapa"
 ],
 [
  "0 % Behang = geschlossen, 100 % = offen. Lamellen: 100 % = waagerecht. Wartezeiten bestätigen keine Endposition; die bestehende Fahrtsperre bleibt zusätzlich wirksam. Beschattungsfahrten beachten Windalarm und Rückfahrtsperren. Eine Scene-Fahrt pausiert die Sonnenautomatik wie eine manuelle Fahrt.",
  "Shading: 0% = closed, 100% = open. Slats: 100% = horizontal. Waits do not confirm the final position; the existing movement lock still applies. Shading movements respect wind alarms and return locks. A Scene movement pauses sun automation like a manual movement.",
  "Protection solaire : 0 % = fermée, 100 % = ouverte. Lames : 100 % = horizontales. Les attentes ne confirment pas la position finale ; le verrouillage des mouvements reste applicable. Les mouvements respectent l’alarme de vent et les verrouillages de retour. Un mouvement de scène suspend l’automatisme solaire comme un mouvement manuel.",
  "Protección solar: 0 % = cerrada, 100 % = abierta. Lamas: 100 % = horizontales. Las esperas no confirman la posición final; sigue aplicándose el bloqueo de movimiento. Los movimientos respetan la alarma de viento y los bloqueos de retorno. Un movimiento de escena pausa la automatización solar como un movimiento manual."
 ],
 [
  "Mindestabstand zwischen Auslösungen (Sekunden)",
  "Minimum time between triggers (seconds)",
  "Intervalle minimal entre déclenchements (secondes)",
  "Intervalo mínimo entre activaciones (segundos)"
 ],
 [
  "Mindestens 5 Sekunden. Eine dauerhaft erfüllte Bedingung löst nicht wiederholt aus.",
  "At least 5 seconds. A condition that remains true does not trigger repeatedly.",
  "Au moins 5 secondes. Une condition qui reste remplie ne se déclenche pas en boucle.",
  "Al menos 5 segundos. Una condición que sigue cumpliéndose no se activa repetidamente."
 ],
 [
  "Protokoll · letzte 10 Ereignisse",
  "History · last 10 events",
  "Journal · 10 derniers événements",
  "Registro: últimos 10 eventos"
 ],
 [
  "Startbedingungen erfüllt",
  "Start conditions met",
  "Conditions de départ remplies",
  "Condiciones iniciales cumplidas"
 ],
 [
  "Noch keine aktuelle Prüfung",
  "No current check yet",
  "Aucune vérification actuelle",
  "Aún no hay una comprobación actual"
 ],
 [
  "Scene ausgeschaltet oder außerhalb des Zeitplans",
  "Scene off or outside its schedule",
  "Scène désactivée ou hors planification",
  "Escena desactivada o fuera de horario"
 ],
 [
  "Startbedingungen derzeit nicht verlässlich prüfbar",
  "Start conditions cannot currently be verified reliably",
  "Conditions de départ non vérifiables avec fiabilité pour le moment",
  "No se pueden verificar con fiabilidad las condiciones iniciales ahora"
 ],
 [
  "Startbedingungen nicht erfüllt",
  "Start conditions not met",
  "Conditions de départ non remplies",
  "Condiciones iniciales no cumplidas"
 ],
 [
  "Letzte Auslösung: {time}",
  "Last trigger: {time}",
  "Dernier déclenchement : {time}",
  "Última activación: {time}"
 ],
 [
  " · Schritt {step}/{total}",
  " · Step {step}/{total}",
  " · Étape {step}/{total}",
  " · Paso {step}/{total}"
 ],
 [
  "Noch keine Auslösung",
  "No trigger yet",
  "Aucun déclenchement",
  "Aún no se ha activado"
 ],
 [
  "Noch keine protokollierten Ereignisse.",
  "No events recorded yet.",
  "Aucun événement enregistré.",
  "Aún no hay eventos registrados."
 ],
 [
  "Scene-Status konnte nicht geladen werden. Konfiguration bleibt erhalten.",
  "Scene status could not be loaded. Configuration is preserved.",
  "Impossible de charger l’état des scènes. La configuration est conservée.",
  "No se pudo cargar el estado de las escenas. Se conserva la configuración."
 ],
 [
  "Schaltzustand",
  "Switch state",
  "État de commutation",
  "Estado del interruptor"
 ],
 [
  "Helligkeit (%)",
  "Brightness (%)",
  "Luminosité (%)",
  "Brillo (%)"
 ],
 [
  "Temperatur (°C)",
  "Temperature (°C)",
  "Température (°C)",
  "Temperatura (°C)"
 ],
 [
  "Luftfeuchte (%)",
  "Humidity (%)",
  "Humidité (%)",
  "Humedad (%)"
 ],
 [
  "Helligkeit (lux)",
  "Illuminance (lux)",
  "Éclairement (lux)",
  "Iluminancia (lux)"
 ],
 [
  "Batterie (%)",
  "Battery (%)",
  "Batterie (%)",
  "Batería (%)"
 ],
 [
  "Kontakt (0 geschlossen / 1 offen)",
  "Contact (0 closed / 1 open)",
  "Contact (0 fermé / 1 ouvert)",
  "Contacto (0 cerrado / 1 abierto)"
 ],
 [
  "Leistung (W)",
  "Power (W)",
  "Puissance (W)",
  "Potencia (W)"
 ],
 [
  "Energie (kWh)",
  "Energy (kWh)",
  "Énergie (kWh)",
  "Energía (kWh)"
 ],
 [
  "Spannung (V)",
  "Voltage (V)",
  "Tension (V)",
  "Tensión (V)"
 ],
 [
  "Strom (A)",
  "Current (A)",
  "Courant (A)",
  "Corriente (A)"
 ],
 [
  "Behang (%)",
  "Shading position (%)",
  "Position du store (%)",
  "Posición de la persiana (%)"
 ],
 [
  "Lamellen (%)",
  "Slat position (%)",
  "Position des lames (%)",
  "Posición de las lamas (%)"
 ],
 [
  "Auto",
  "Sun automation",
  "Automatisme solaire",
  "Automatización solar"
 ],
 [
  "Automatik Pause",
  "Automation pause",
  "Pause de l’automatisme",
  "Pausa de automatización"
 ],
 [
  "Windalarm",
  "Wind alarm",
  "Alarme de vent",
  "Alarma de viento"
 ],
 [
  "Ein / Aus",
  "On / Off",
  "Marche / Arrêt",
  "Encendido / Apagado"
 ],
 [
  "Scene: Bedingungsbaum zu groß oder ungültig (maximal 5 Ebenen und 64 Elemente).",
  "Scene: condition tree is too large or invalid (maximum 5 levels and 64 elements).",
  "Scène : arbre de conditions trop grand ou non valide (5 niveaux et 64 éléments au maximum).",
  "Escena: árbol de condiciones demasiado grande o no válido (máximo 5 niveles y 64 elementos)."
 ],
 [
  "Scene: UND-/ODER-Gruppe benötigt 1 bis 16 Bedingungen.",
  "Scene: an AND/OR group needs 1 to 16 conditions.",
  "Scène : un groupe ET/OU doit contenir 1 à 16 conditions.",
  "Escena: un grupo Y/O necesita de 1 a 16 condiciones."
 ],
 [
  "Scene: Bedingungsart prüfen.",
  "Scene: check the condition type.",
  "Scène : vérifiez le type de condition.",
  "Escena: compruebe el tipo de condición."
 ],
 [
  "Scene: Uhrzeit und Wochentage prüfen.",
  "Scene: check the time and weekdays.",
  "Scène : vérifiez l’heure et les jours de la semaine.",
  "Escena: compruebe la hora y los días de la semana."
 ],
 [
  "Scene: Quelle nicht verfügbar.",
  "Scene: source unavailable.",
  "Scène : source indisponible.",
  "Escena: origen no disponible."
 ],
 [
  "Scene: Vergleich prüfen.",
  "Scene: check the comparison.",
  "Scène : vérifiez la comparaison.",
  "Escena: compruebe la comparación."
 ],
 [
  "Scene: Schaltzustände benötigen Ein/Aus-Vergleich.",
  "Scene: switch states require an on/off comparison.",
  "Scène : les états de commutation nécessitent une comparaison marche/arrêt.",
  "Escena: los estados de interruptor requieren una comparación encendido/apagado."
 ],
 [
  "Scene: Zahlenwert erforderlich.",
  "Scene: a numeric value is required.",
  "Scène : une valeur numérique est requise.",
  "Escena: se requiere un valor numérico."
 ],
 [
  "Scene: Hysterese muss positiv oder null sein.",
  "Scene: hysteresis must be positive or zero.",
  "Scène : l’hystérésis doit être positive ou nulle.",
  "Escena: la histéresis debe ser positiva o cero."
 ],
 [
  "Scene: Bedingungsdauer muss zwischen 0 und 86400 ganzen Sekunden liegen.",
  "Scene: condition duration must be an integer from 0 to 86400 seconds.",
  "Scène : la durée de la condition doit être un entier entre 0 et 86400 secondes.",
  "Escena: la duración de la condición debe ser un número entero entre 0 y 86400 segundos."
 ],
 [
  "Scene: Shelly und gewählter Zustand passen nicht zusammen.",
  "Scene: the Shelly and selected state do not match.",
  "Scène : le Shelly et l’état sélectionné ne correspondent pas.",
  "Escena: el Shelly y el estado seleccionado no coinciden."
 ],
 [
  "Scene: maximal 100 Scenes möglich.",
  "Scene: a maximum of 100 Scenes is allowed.",
  "Scène : 100 scènes au maximum sont autorisées.",
  "Escena: se permite un máximo de 100 escenas."
 ],
 [
  "Scene benötigt einen Namen und eine eindeutige ID.",
  "A Scene needs a name and a unique ID.",
  "Une scène doit avoir un nom et un identifiant unique.",
  "Una escena necesita un nombre y un ID único."
 ],
 [
  "Scene: Rücksetzung muss ein/aus sein.",
  "Scene: restore must be on/off.",
  "Scène : le rétablissement doit être activé ou désactivé.",
  "Escena: la restauración debe estar activada o desactivada."
 ],
 [
  "Scene aktiv muss ein/aus sein.",
  "Scene active must be on/off.",
  "L’activation de la scène doit être oui/non.",
  "La activación de la escena debe estar activada o desactivada."
 ],
 [
  "Scene: Betriebsart prüfen.",
  "Scene: check the mode.",
  "Scène : vérifiez le mode.",
  "Escena: compruebe el modo."
 ],
 [
  "Scene: Zeitplan mit unterschiedlichen Beginn-/Endzeiten und Wochentagen angeben.",
  "Scene: specify a schedule with different start/end times and weekdays.",
  "Scène : indiquez une planification avec des heures de début/fin différentes et des jours de la semaine.",
  "Escena: indique un horario con horas de inicio y fin distintas y días de la semana."
 ],
 [
  "Scene: Bedingung und Aktion vervollständigen.",
  "Scene: complete the condition and action.",
  "Scène : complétez la condition et l’action.",
  "Escena: complete la condición y la acción."
 ],
 [
  "Scene: Mindestabstand muss zwischen 5 und 86400 Sekunden liegen.",
  "Scene: minimum interval must be between 5 and 86400 seconds.",
  "Scène : l’intervalle minimal doit être compris entre 5 et 86400 secondes.",
  "Escena: el intervalo mínimo debe estar entre 5 y 86400 segundos."
 ],
 [
  "Scene: maximal 20 Aktionen und insgesamt 24 Stunden Wartezeit.",
  "Scene: at most 20 actions and 24 hours of total wait time.",
  "Scène : au maximum 20 actions et 24 heures d’attente au total.",
  "Escena: como máximo 20 acciones y 24 horas de espera total."
 ],
 [
  "Scene: Wartezeit muss zwischen 0 und 86400 ganzen Sekunden liegen.",
  "Scene: wait time must be an integer from 0 to 86400 seconds.",
  "Scène : l’attente doit être un entier entre 0 et 86400 secondes.",
  "Escena: el tiempo de espera debe ser un número entero entre 0 y 86400 segundos."
 ],
 [
  "Scene: Maximale Bedingungswartezeit muss zwischen 1 und 86400 ganzen Sekunden liegen.",
  "Scene: maximum condition wait must be an integer from 1 to 86400 seconds.",
  "Scène : l’attente maximale des conditions doit être un entier entre 1 et 86400 secondes.",
  "Escena: la espera máxima de condiciones debe ser un número entero entre 1 y 86400 segundos."
 ],
 [
  "Scene: Ziel nicht verfügbar.",
  "Scene: target unavailable.",
  "Scène : cible indisponible.",
  "Escena: destino no disponible."
 ],
 [
  "Scene: Ausgang nicht konfiguriert.",
  "Scene: output not configured.",
  "Scène : sortie non configurée.",
  "Escena: salida no configurada."
 ],
 [
  "Scene: Funktion am Ziel nicht eingerichtet.",
  "Scene: function not configured on the target.",
  "Scène : fonction non configurée sur la cible.",
  "Escena: función no configurada en el destino."
 ],
 [
  "Scene: Zielwert prüfen.",
  "Scene: check the target value.",
  "Scène : vérifiez la valeur cible.",
  "Escena: compruebe el valor de destino."
 ],
 [
  "Scene: Regelschleife erkannt. Gegenseitige Geräte-Auslösung ist nicht zulässig.",
  "Scene: control loop detected. Devices may not trigger each other in a loop.",
  "Scène : boucle de commande détectée. Les appareils ne peuvent pas se déclencher mutuellement en boucle.",
  "Escena: se ha detectado un bucle de control. Los dispositivos no pueden activarse mutuamente en un bucle."
 ],
 [
  "Gespeicherte Scene-Zustände sind nicht lesbar.",
  "Saved Scene states could not be read.",
  "Impossible de lire les états des scènes enregistrés.",
  "No se pudieron leer los estados de escena guardados."
 ],
 [
  "Nach Neustart abgebrochen",
  "Aborted after restart",
  "Interrompue après le redémarrage",
  "Interrumpida tras el reinicio"
 ],
 [
  "Rücksetzung nach Neustart aufgehoben",
  "Restore cancelled after restart",
  "Rétablissement annulé après le redémarrage",
  "Restauración cancelada tras el reinicio"
 ],
 [
  "Scene: {message}",
  "Scene: {message}",
  "Scène : {message}",
  "Escena: {message}"
 ],
 [
  "Auslösung verworfen – Aktionsgrenze",
  "Trigger discarded – action limit",
  "Déclenchement ignoré – limite d’actions",
  "Activación descartada: límite de acciones"
 ],
 [
  "Aktionsgrenze erreicht; Auslösung verworfen.",
  "Action limit reached; trigger discarded.",
  "Limite d’actions atteinte ; déclenchement ignoré.",
  "Límite de acciones alcanzado; activación descartada."
 ],
 [
  "Status nicht speicherbar; Aktion gesperrt.",
  "Status could not be saved; action blocked.",
  "Impossible d’enregistrer l’état ; action bloquée.",
  "No se pudo guardar el estado; acción bloqueada."
 ],
 [
  "Scene {name}: Aktionsgrenze erreicht; Auslösung verworfen.",
  "Scene {name}: action limit reached; trigger discarded.",
  "Scène {name} : limite d’actions atteinte ; déclenchement ignoré.",
  "Escena {name}: límite de acciones alcanzado; activación descartada."
 ],
 [
  "Scene {name}: Status nicht speicherbar; Aktion gesperrt.",
  "Scene {name}: status could not be saved; action blocked.",
  "Scène {name} : impossible d’enregistrer l’état ; action bloquée.",
  "Escena {name}: no se pudo guardar el estado; acción bloqueada."
 ],
 [
  "Befehl wird übergeben",
  "Sending command",
  "Envoi de la commande",
  "Enviando orden"
 ],
 [
  "Plugin beendet",
  "Plugin stopped",
  "Extension arrêtée",
  "Plugin detenido"
 ],
 [
  "Scene deaktiviert",
  "Scene disabled",
  "Scène désactivée",
  "Escena desactivada"
 ],
 [
  "Zeitfenster beendet",
  "Time window ended",
  "Plage horaire terminée",
  "Intervalo horario terminado"
 ],
 [
  "Bedingung oder Befehlsfreigabe nicht mehr bestätigt",
  "Condition or command permission no longer confirmed",
  "Condition ou autorisation de commande non confirmée",
  "La condición o el permiso de la orden ya no están confirmados"
 ],
 [
  "Scene wurde beendet.",
  "Scene was stopped.",
  "La scène a été arrêtée.",
  "La escena se ha detenido."
 ],
 [
  "Scene beendet.",
  "Scene stopped.",
  "Scène arrêtée.",
  "Escena detenida."
 ],
 [
  "Beschattung nicht verfügbar.",
  "Shading unavailable.",
  "Protection solaire indisponible.",
  "Protección solar no disponible."
 ],
 [
  "Keine aktuelle Positionsrückmeldung.",
  "No current position feedback.",
  "Aucun retour de position actuel.",
  "No hay información actual de posición."
 ],
 [
  "Windalarm oder Rückfahrtsperre aktiv.",
  "Wind alarm or return lock active.",
  "Alarme de vent ou verrouillage de retour actif.",
  "Alarma de viento o bloqueo de retorno activo."
 ],
 [
  "Scene-Funktion nicht verfügbar.",
  "Scene function unavailable.",
  "Fonction de scène indisponible.",
  "Función de escena no disponible."
 ],
 [
  "Stufe {step}: wartet auf Bedingungen",
  "Stage {step}: waiting for conditions",
  "Étape {step} : attente des conditions",
  "Etapa {step}: esperando condiciones"
 ],
 [
  "Stufe {step}: Bedingungen erfüllt",
  "Stage {step}: conditions met",
  "Étape {step} : conditions remplies",
  "Etapa {step}: condiciones cumplidas"
 ],
 [
  "Stufe {step} begonnen",
  "Stage {step} started",
  "Étape {step} démarrée",
  "Etapa {step} iniciada"
 ],
 [
  "Aktion {step}/{total}: wartet {seconds} Sekunden",
  "Action {step}/{total}: waiting {seconds} seconds",
  "Action {step}/{total} : attente de {seconds} secondes",
  "Acción {step}/{total}: esperando {seconds} segundos"
 ],
 [
  "Aktion {step}/{total}: Befehl wird übergeben",
  "Action {step}/{total}: sending command",
  "Action {step}/{total} : envoi de la commande",
  "Acción {step}/{total}: enviando orden"
 ],
 [
  "Stufe {step}: Befehl übergeben; Endzustand nicht bestätigt",
  "Stage {step}: command sent; final state not confirmed",
  "Étape {step} : commande transmise ; état final non confirmé",
  "Etapa {step}: orden enviada; estado final no confirmado"
 ],
 [
  "Befehl übergeben",
  "Command sent",
  "Commande transmise",
  "Orden enviada"
 ],
 [
  "Aktionsfolge beendet – Befehle übergeben",
  "Action sequence finished – commands sent",
  "Séquence d’actions terminée – commandes transmises",
  "Secuencia de acciones terminada: órdenes enviadas"
 ],
 [
  "Aktionsfolge abgebrochen: {reason}",
  "Action sequence aborted: {reason}",
  "Séquence d’actions interrompue : {reason}",
  "Secuencia de acciones interrumpida: {reason}"
 ],
 [
  "Maximale Bedingungswartezeit abgelaufen",
  "Maximum condition wait exceeded",
  "Attente maximale des conditions dépassée",
  "Se ha agotado la espera máxima de condiciones"
 ],
 [
  "Bedingungswartezeit abgelaufen.",
  "Condition wait exceeded.",
  "Délai d’attente des conditions dépassé.",
  "Se ha agotado la espera de condiciones."
 ],
 [
  "Aktionsgrenze erreicht.",
  "Action limit reached.",
  "Limite d’actions atteinte.",
  "Límite de acciones alcanzado."
 ],
 [
  "Kein aktueller Ausgangszustand – Scene nicht ausgeführt",
  "No current initial state – Scene not executed",
  "Aucun état initial actuel – scène non exécutée",
  "Sin estado inicial actual: escena no ejecutada"
 ],
 [
  "Aktion fehlgeschlagen",
  "Action failed",
  "Échec de l’action",
  "Acción fallida"
 ],
 [
  "Wartet auf Rücksetzung der Startbedingungen",
  "Waiting for start conditions to reset",
  "Attente de la réinitialisation des conditions de départ",
  "Esperando a que se restablezcan las condiciones iniciales"
 ],
 [
  "Rücksetzung gesperrt: Status konnte nicht gespeichert werden",
  "Restore blocked: status could not be saved",
  "Rétablissement bloqué : impossible d’enregistrer l’état",
  "Restauración bloqueada: no se pudo guardar el estado"
 ],
 [
  "Scene: Ergebnis konnte nicht gespeichert werden.",
  "Scene: result could not be saved.",
  "Scène : impossible d’enregistrer le résultat.",
  "Escena: no se pudo guardar el resultado."
 ],
 [
  "Kein aktueller Ausgangszustand für die Rücksetzung.",
  "No current initial state for restore.",
  "Aucun état initial actuel pour le rétablissement.",
  "Sin estado inicial actual para la restauración."
 ],
 [
  "Ausgangszustände für Rücksetzung gespeichert",
  "Initial states saved for restore",
  "États initiaux enregistrés pour le rétablissement",
  "Estados iniciales guardados para restaurar"
 ],
 [
  "Startbedingungen zurückgesetzt – Rücksetzung angefordert",
  "Start conditions reset – restore requested",
  "Conditions de départ réinitialisées – rétablissement demandé",
  "Condiciones iniciales restablecidas: restauración solicitada"
 ],
 [
  "Vorherige Zustände werden wiederhergestellt",
  "Restoring previous states",
  "Rétablissement des états précédents",
  "Restaurando estados anteriores"
 ],
 [
  "{target} · {property}: Rücksetzung ausgelassen – {reason}",
  "{target} · {property}: restore skipped – {reason}",
  "{target} · {property} : rétablissement ignoré – {reason}",
  "{target} · {property}: restauración omitida: {reason}"
 ],
 [
  "vorheriger Befehl nicht eindeutig bestätigt",
  "previous command not clearly confirmed",
  "commande précédente non confirmée clairement",
  "la orden anterior no se ha confirmado claramente"
 ],
 [
  "neuere Steuerung hat Vorrang",
  "a more recent command takes precedence",
  "une commande plus récente est prioritaire",
  "una orden más reciente tiene prioridad"
 ],
 [
  "keine aktuellen Zieldaten",
  "no current target data",
  "aucune donnée actuelle de la cible",
  "sin datos actuales del destino"
 ],
 [
  "Ziel wurde zwischenzeitlich verändert",
  "target was changed in the meantime",
  "la cible a été modifiée entre-temps",
  "el destino se ha modificado entretanto"
 ],
 [
  "Freigabe oder Zielzustand nicht mehr bestätigt",
  "permission or target state no longer confirmed",
  "autorisation ou état cible non confirmé",
  "el permiso o el estado de destino ya no están confirmados"
 ],
 [
  "Rücksetzung wartet auf freie Aktionskapazität",
  "Restore waiting for action capacity",
  "Rétablissement en attente de capacité d’action",
  "Restauración esperando capacidad para acciones"
 ],
 [
  "{target} · {property}: Befehl für vorherigen Wert {value} wird übergeben",
  "{target} · {property}: sending command for previous value {value}",
  "{target} · {property} : envoi de la commande pour la valeur précédente {value}",
  "{target} · {property}: enviando orden para el valor anterior {value}"
 ],
 [
  "{target} · {property}: Befehl übergeben; Endzustand noch nicht bestätigt",
  "{target} · {property}: command sent; final state not yet confirmed",
  "{target} · {property} : commande transmise ; état final pas encore confirmé",
  "{target} · {property}: orden enviada; estado final aún no confirmado"
 ],
 [
  "{target} · {property}: vorherige Position durch Rückmeldung bestätigt",
  "{target} · {property}: previous position confirmed by feedback",
  "{target} · {property} : position précédente confirmée par le retour d’état",
  "{target} · {property}: posición anterior confirmada por la información de estado"
 ],
 [
  "Befehl fehlgeschlagen oder Schutzsperre aktiv; keine Wiederholung",
  "command failed or protection lock active; no retry",
  "échec de la commande ou verrouillage de protection actif ; aucun nouvel essai",
  "orden fallida o bloqueo de protección activo; sin reintento"
 ],
 [
  "Rücksetzung: {restored} Befehle übergeben",
  "Restore: {restored} commands sent",
  "Rétablissement : {restored} commandes transmises",
  "Restauración: {restored} órdenes enviadas"
 ],
 [
  "Rücksetzung: {restored} Befehle übergeben, {skipped} ausgelassen",
  "Restore: {restored} commands sent, {skipped} skipped",
  "Rétablissement : {restored} commandes transmises, {skipped} ignorées",
  "Restauración: {restored} órdenes enviadas, {skipped} omitidas"
 ],
 [
  "{status}; Endzustände nicht bestätigt",
  "{status}; final states not confirmed",
  "{status} ; états finaux non confirmés",
  "{status}; estados finales no confirmados"
 ],
 [
  "Rücksetzung abgebrochen: Bedingung erneut aktiv oder Plugin beendet",
  "Restore aborted: condition active again or plugin stopped",
  "Rétablissement interrompu : condition de nouveau active ou extension arrêtée",
  "Restauración interrumpida: la condición vuelve a estar activa o el plugin se ha detenido"
 ],
 [
  "Scene: Rücksetzergebnis konnte nicht gespeichert werden.",
  "Scene: restore result could not be saved.",
  "Scène : impossible d’enregistrer le résultat du rétablissement.",
  "Escena: no se pudo guardar el resultado de la restauración."
 ],
 [
  "Aktionsgrenze erreicht; Auslösung verworfen",
  "Action limit reached; trigger discarded",
  "Limite d’actions atteinte ; déclenchement ignoré",
  "Límite de acciones alcanzado; activación descartada"
 ],
 [
  "Status nicht speicherbar; Aktion gesperrt",
  "Status could not be saved; action blocked",
  "Impossible d’enregistrer l’état ; action bloquée",
  "No se pudo guardar el estado; acción bloqueada"
 ],
 [
  "Kanal {number}",
  "Channel {number}",
  "Canal {number}",
  "Canal {number}"
 ],
 [
  "Eingang {number}",
  "Input {number}",
  "Entrée {number}",
  "Entrada {number}"
 ],
 [
  "Add-on Eingang",
  "Add-on input",
  "Entrée du module",
  "Entrada del módulo"
 ]
];
 const dictionaries={de:{},en:{},fr:{},es:{}};
 for(const [key,...translations] of rows){dictionaries.de[key]=key;['en','fr','es'].forEach((language,index)=>{dictionaries[language][key]=translations[index];});}
 I.register('scenes',dictionaries);
 return dictionaries;
});
