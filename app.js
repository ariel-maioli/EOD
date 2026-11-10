(() => {
  "use strict";

  const APP_VERSION = "20261110.4";
  let config = window.EOD_CONFIG;
  const byId = (id) => document.getElementById(id);
  const state = {
    client: null,
    user: null,
    profile: null,
    activeView: null,
    visits: [],
    paymentDetails: new Map(),
    properties: [],
    assignments: [],
    profiles: [],
    trackingSettings: { visits_per_workday: 2, alert_days: 15 },
    audit: [],
    editingId: null,
    viewAsTechnicianId: "",
    maintenanceEnabled: false,
    busy: false,
    noticeTimer: null,
    visitSuccessTimer: null,
    searchRequestId: 0,
    searchTimer: null
  };

  function showNotice(message, isError = false) {
    window.clearTimeout(state.noticeTimer);
    state.noticeTimer = null;
    const notice = byId("notice");
    notice.textContent = message;
    notice.classList.toggle("error", isError);
    notice.setAttribute("role", isError ? "alert" : "status");
    notice.setAttribute("aria-live", isError ? "assertive" : "polite");
    notice.classList.toggle("success-notice", !isError);
    notice.hidden = false;
    if (isError) {
      notice.focus({ preventScroll: true });
      notice.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      state.noticeTimer = window.setTimeout(clearNotice, 4500);
    }
  }

  function clearNotice() {
    window.clearTimeout(state.noticeTimer);
    state.noticeTimer = null;
    byId("notice").hidden = true;
    byId("notice").textContent = "";
    byId("notice").classList.remove("error");
    byId("notice").classList.remove("success-notice");
    byId("notice").setAttribute("role", "status");
    byId("notice").setAttribute("aria-live", "polite");
  }

  function focusPropertyNumber() {
    byId("property-number").focus();
  }

  function showVisitSuccess(message) {
    window.clearTimeout(state.visitSuccessTimer);
    const notice = byId("visit-success");
    notice.textContent = message;
    notice.hidden = false;
    state.visitSuccessTimer = window.setTimeout(() => {
      notice.hidden = true;
      state.visitSuccessTimer = null;
    }, 4500);
  }

  function hideVisitSuccess() {
    window.clearTimeout(state.visitSuccessTimer);
    state.visitSuccessTimer = null;
    byId("visit-success").hidden = true;
  }

  function setBusy(busy) {
    state.busy = busy;
    document.querySelectorAll("button").forEach((button) => {
      button.disabled = busy;
    });
    byId("view-as-technician").disabled = busy;
  }

  async function checkForAppUpdate() {
    if (byId("login-panel").hidden || document.visibilityState !== "visible") return;
    if (byId("login-password").value || byId("login-form").contains(document.activeElement)) return;

    try {
      const versionUrl = new URL("version.json", window.location.href);
      versionUrl.searchParams.set("check", String(Date.now()));
      const response = await fetch(versionUrl, { cache: "no-store" });
      if (!response.ok) throw new Error(`Version check returned HTTP ${response.status}`);
      const latest = await response.json();
      if (typeof latest.version !== "string") {
        throw new Error("The version file does not contain a valid version");
      }
      if (latest.version !== APP_VERSION) {
        const pageUrl = new URL(window.location.href);
        pageUrl.searchParams.set("eod-version", latest.version);
        window.location.replace(pageUrl.href);
      }
    } catch (error) {
      console.warn("No se pudo comprobar si hay una actualización de EOD.", error);
    }
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[character]);
  }

  function localDateInputValue(date = new Date()) {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  function currentArgentinaWeek() {
    const [year, month, day] = argentinaDateKey(new Date()).split("-").map(Number);
    const today = new Date(Date.UTC(year, month - 1, day));
    const daysSinceMonday = (today.getUTCDay() + 6) % 7;
    const monday = new Date(today);
    monday.setUTCDate(today.getUTCDate() - daysSinceMonday);
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    const dateKey = (value) => value.toISOString().slice(0, 10);
    return { from: dateKey(monday), to: dateKey(sunday) };
  }

  function setAdminVisitWeek() {
    const { from, to } = currentArgentinaWeek();
    byId("filter-from").value = from;
    byId("filter-to").value = to;
    byId("filter-user").value = "";
    byId("filter-status").value = "active";
  }

  function setVisitDateLimit() {
    byId("visit-date").max = localDateInputValue();
  }

  function formatDate(value) {
    if (!value) return "Sin fecha";
    const [year, month, day] = value.slice(0, 10).split("-");
    return `${day}/${month}/${year.slice(-2)}`;
  }

  function formatPaymentDate(value) {
    if (!value) return "Sin fecha";
    return new Intl.DateTimeFormat("es-AR", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      timeZone: "America/Argentina/Buenos_Aires"
    }).format(new Date(value));
  }

  function argentinaDateKey(value) {
    const parts = new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: "America/Argentina/Buenos_Aires"
    }).formatToParts(value);
    const part = (type) => parts.find((item) => item.type === type)?.value;
    return `${part("year")}-${part("month")}-${part("day")}`;
  }

  function formatDateTime(value) {
    return new Intl.DateTimeFormat("es-AR", {
      dateStyle: "short",
      timeStyle: "short"
    }).format(new Date(value));
  }

  function normalize(value) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("es");
  }

  function profileName(id) {
    const found = state.profiles.find((profile) => profile.id === id)
      || (state.profile?.id === id ? state.profile : null);
    return found?.display_name?.trim() || found?.email || "Usuario";
  }

  function greetingForCurrentTime() {
    const hour = Number(new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      hourCycle: "h23",
      timeZone: "America/Argentina/Buenos_Aires"
    }).formatToParts(new Date()).find((part) => part.type === "hour")?.value);
    if (hour >= 5 && hour < 12) return "Buenos días";
    if (hour >= 12 && hour < 20) return "Buenas tardes";
    return "Buenas noches";
  }

  function propertyFor(number) {
    return state.properties.find((property) => property.property_number === number);
  }

  function parsePropertyList(value) {
    return value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
  }

  function csvDelimiter(text) {
    let commas = 0;
    let semicolons = 0;
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (character === '"') {
        if (quoted && text[index + 1] === '"') index += 1;
        else quoted = !quoted;
      } else if (!quoted && (character === "\n" || character === "\r")) {
        break;
      } else if (!quoted && character === ",") {
        commas += 1;
      } else if (!quoted && character === ";") {
        semicolons += 1;
      }
    }
    return semicolons > commas ? ";" : ",";
  }

  function parseCsv(text) {
    const source = text.replace(/^\uFEFF/, "");
    const delimiter = csvDelimiter(source);
    const records = [];
    let record = [];
    let field = "";
    let quoted = false;

    for (let index = 0; index < source.length; index += 1) {
      const character = source[index];
      if (character === '"') {
        if (quoted && source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = !quoted;
        }
      } else if (!quoted && character === delimiter) {
        record.push(field);
        field = "";
      } else if (!quoted && (character === "\n" || character === "\r")) {
        if (character === "\r" && source[index + 1] === "\n") index += 1;
        record.push(field);
        if (record.some((value) => value.trim())) records.push(record);
        record = [];
        field = "";
      } else {
        field += character;
      }
    }

    if (quoted) throw new Error("El CSV tiene comillas sin cerrar.");
    if (field.length || record.length) {
      record.push(field);
      if (record.some((value) => value.trim())) records.push(record);
    }
    if (!records.length) throw new Error("El archivo CSV está vacío.");

    const normalizeHeader = (value) => normalize(value).trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    const headerAliases = {
      property_number: ["predio", "numero_predio", "nro_predio"],
      notes: ["notas"],
      visit_date: ["fecha"],
      contact_name: ["contacto", "nombre", "nombre_contacto"],
      cellphone: ["celular", "telefono", "teléfono"]
    };
    const header = records[0].map(normalizeHeader);
    const indexes = {};
    for (const [fieldName, aliases] of Object.entries(headerAliases)) {
      indexes[fieldName] = header.findIndex((value) => aliases.includes(value));
    }
    const missing = Object.entries(indexes).filter(([, index]) => index === -1).map(([fieldName]) => ({
      property_number: "Predio",
      notes: "Notas",
      visit_date: "Fecha",
      contact_name: "Contacto",
      cellphone: "Celular"
    })[fieldName]);
    if (missing.length) {
      throw new Error(`Faltan columnas requeridas: ${missing.join(", ")}.`);
    }
    if (new Set(Object.values(indexes)).size !== Object.values(indexes).length) {
      throw new Error("El encabezado contiene columnas repetidas.");
    }
    if (records.length - 1 > 2000) throw new Error("El archivo supera el límite de 2.000 filas.");

    const parseDate = (value) => {
      const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (!match) return "";
      const [, dayText, monthText, yearText] = match;
      const day = Number(dayText);
      const month = Number(monthText);
      const year = Number(yearText);
      const date = new Date(Date.UTC(year, month - 1, day));
      if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1
          || date.getUTCDate() !== day) return "";
      return `${yearText}-${monthText}-${dayText}`;
    };

    return records.slice(1).map((cells, index) => {
      const item = (name) => cells[indexes[name]]?.trim() || "";
      return {
        row_number: index + 2,
        property_number: item("property_number"),
        notes: item("notes"),
        visit_date: parseDate(item("visit_date")),
        contact_name: item("contact_name"),
        cellphone: item("cellphone"),
        ...(cells.length !== header.length
          ? { parse_error: "La fila no tiene la misma cantidad de columnas que el encabezado." }
          : {})
      };
    });
  }

  async function fetchAllRows(table, orderColumn) {
    const rows = [];
    const pageSize = 500;
    let offset = 0;
    while (true) {
      const { data, error } = await state.client.from(table)
        .select("*")
        .order(orderColumn, { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < pageSize) return rows;
      offset += pageSize;
    }
  }

  function isAdmin() {
    return state.profile?.role === "admin";
  }

  function isTechnicianPreview() {
    return isAdmin() && Boolean(state.viewAsTechnicianId);
  }

  function canUseAdminFeatures() {
    return isAdmin() && !isTechnicianPreview();
  }

  function isTechnicianExperience() {
    return !isAdmin() || isTechnicianPreview();
  }

  function dataUserId() {
    if (isTechnicianPreview()) return state.viewAsTechnicianId;
    return isAdmin() ? "" : state.user?.id || "";
  }

  async function closeSessionForMaintenance() {
    let signOutError = null;
    try {
      const { error } = await state.client.auth.signOut();
      signOutError = error;
    } catch (error) {
      signOutError = error;
    }
    showLoggedOut();
    if (signOutError) {
      showNotice(
        `Modo de mantenimiento activo, pero no se pudo cerrar completamente la sesión: ${humanError(signOutError)}`,
        true
      );
      return false;
    }
    showNotice("Modo de mantenimiento activo. Se cerró tu sesión.");
    return true;
  }

  async function refreshMaintenanceStatus() {
    const { data, error } = await state.client.rpc("get_maintenance_status");
    if (error) throw error;
    if (typeof data !== "boolean") {
      throw new Error("Supabase devolvió un estado de mantenimiento inválido.");
    }

    state.maintenanceEnabled = data;
    byId("maintenance-banner").hidden = !data;
    if (data && state.user && state.profile && !isAdmin()) {
      await closeSessionForMaintenance();
    }
    return data;
  }

  async function handleMaintenanceCheckFailure(error) {
    const shouldCloseSession = Boolean(state.user && !isAdmin());
    if (shouldCloseSession) {
      let signOutError = null;
      try {
        const { error: authError } = await state.client.auth.signOut();
        signOutError = authError;
      } catch (authError) {
        signOutError = authError;
      }
      showLoggedOut();
      if (signOutError) {
        showNotice(
          `No se pudo verificar el modo de mantenimiento (${humanError(error)}) ni cerrar la sesión (${humanError(signOutError)}).`,
          true
        );
        return;
      }
    }
    showNotice(
      `No se pudo verificar el modo de mantenimiento. ${humanError(error)}${shouldCloseSession ? " Se cerró la sesión por seguridad." : ""}`,
      true
    );
  }

  function startMaintenanceChecks() {
    const check = () => refreshMaintenanceStatus().catch(handleMaintenanceCheckFailure);
    window.setInterval(() => {
      if (document.visibilityState === "visible") check();
    }, 15000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") check();
    });
  }

  function setView(viewId) {
    state.activeView = viewId;
    state.searchRequestId += 1;
    window.clearTimeout(state.searchTimer);
    document.querySelectorAll(".view-panel").forEach((panel) => {
      panel.hidden = panel.id !== viewId;
    });
    document.querySelectorAll(".tab-button").forEach((button) => {
      if (button.dataset.view === viewId) {
        button.setAttribute("aria-current", "page");
      } else {
        button.removeAttribute("aria-current");
      }
    });
  }

  function showLoggedOut() {
    state.searchRequestId += 1;
    window.clearTimeout(state.searchTimer);
    byId("application").hidden = true;
    byId("session-area").hidden = true;
    byId("login-panel").hidden = false;
    byId("login-form").hidden = false;
    byId("login-password").value = "";
    state.user = null;
    state.profile = null;
    state.activeView = null;
    state.viewAsTechnicianId = "";
    state.visits = [];
    state.paymentDetails = new Map();
    state.properties = [];
    state.assignments = [];
    state.profiles = [];
    state.trackingSettings = { visits_per_workday: 2, alert_days: 15 };
    state.audit = [];
    state.editingId = null;
  }

  const visitColumns = "id,property_number,visit_date,contact_name,cellphone,notes,created_by,created_at,updated_by,updated_at,archived_at,archived_by";

  function orderedVisitsQuery(includeCount = false) {
    return state.client.from("visits")
      .select(visitColumns, includeCount ? { count: "exact" } : undefined)
      .order("visit_date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: true });
  }

  async function fetchAllVisits() {
    const visits = [];
    const pageSize = 500;
    let offset = 0;
    let totalCount = 0;
    do {
      const { data, error, count } = await orderedVisitsQuery(true)
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      if (count === null) throw new Error("Supabase no devolvió el total de visitas para completar la búsqueda.");
      visits.push(...(data || []));
      totalCount = count || 0;
      offset += (data || []).length;
      if (!data?.length && visits.length < totalCount) {
        throw new Error("La búsqueda de visitas quedó incompleta.");
      }
    } while (visits.length < totalCount);
    return visits;
  }

  function searchUsesAllVisits() {
    return Boolean(
      byId("search-query").value.trim()
      || byId("filter-from").value
      || byId("filter-to").value
      || (canUseAdminFeatures() && byId("filter-user").value)
      || (canUseAdminFeatures() && byId("filter-status").value !== "active")
    );
  }

  async function fetchSearchVisits() {
    if (searchUsesAllVisits()) return fetchAllVisits();

    const userId = isTechnicianPreview() ? state.viewAsTechnicianId : state.user?.id;
    if (!userId) return fetchAllVisits();
    const { data, error } = await orderedVisitsQuery()
      .eq("created_by", userId)
      .limit(25);
    if (error) throw error;
    return data || [];
  }

  function attachVisiblePayments(visits) {
    return visits.map((visit) => {
      const payment = state.paymentDetails.get(visit.id);
      return {
        ...visit,
        paid_at: payment?.paid_at || null,
        paid_by: payment?.paid_by || null
      };
    });
  }

  async function loadData() {
    const [paymentsResult, properties, assignments, profilesResult, settingsResult] = await Promise.all([
      state.client.rpc("get_visible_visit_payments"),
      fetchAllRows("properties", "property_number"),
      fetchAllRows("property_assignments", "assigned_at"),
      state.client.from("profiles").select("id,email,display_name,role"),
      isAdmin() ? state.client.rpc("get_property_tracking_settings") : Promise.resolve({ data: null, error: null })
    ]);

    const failure = [paymentsResult, profilesResult, settingsResult].find((result) => result.error);
    if (failure) throw failure.error;

    state.paymentDetails = new Map(
      (paymentsResult.data || []).map((payment) => [payment.visit_id, payment])
    );
    state.properties = properties;
    state.assignments = assignments;
    state.profiles = profilesResult.data || [];
    if (settingsResult.data) state.trackingSettings = settingsResult.data;
    renderViewAsSelector();
    configureRoleExperience();

    if (state.activeView === "search-view") {
      const requestId = ++state.searchRequestId;
      const visits = attachVisiblePayments(await fetchSearchVisits());
      if (requestId === state.searchRequestId && state.activeView === "search-view") {
        state.visits = visits;
      }
    } else if (state.activeView === "payments-view") {
      state.visits = attachVisiblePayments(await fetchAllVisits());
    } else {
      state.visits = [];
    }

    if (isAdmin()) {
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const { data, error } = await state.client
        .from("audit_log")
        .select("*")
        .gte("changed_at", since.toISOString())
        .order("changed_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      state.audit = data || [];
    } else {
      state.audit = [];
    }

    renderUserFilter();
    renderVisits();
    renderPayments();
    renderActivity();
    renderPropertiesPanel();
  }

  function renderUserFilter() {
    const select = byId("filter-user");
    const selected = select.value;
    const options = ['<option value="">Todos</option>'];
    state.profiles
      .filter((profile) => profile.role === "technician" || profile.role === "admin")
      .slice()
      .sort((a, b) => profileName(a.id).localeCompare(profileName(b.id), "es"))
      .forEach((profile) => {
        options.push(`<option value="${escapeHtml(profile.id)}">${escapeHtml(profileName(profile.id))}${profile.role === "admin" ? " · Admin" : ""}</option>`);
      });
    select.innerHTML = options.join("");
    if (state.profiles.some((profile) => profile.id === selected)) select.value = selected;
  }

  function renderViewAsSelector() {
    const select = byId("view-as-technician");
    const selected = state.viewAsTechnicianId;
    const technicians = state.profiles
      .filter((profile) => profile.role === "technician")
      .sort((a, b) => profileName(a.id).localeCompare(profileName(b.id), "es"));
    select.innerHTML = [
      '<option value="">Administrador</option>',
      ...technicians.map((profile) =>
        `<option value="${escapeHtml(profile.id)}">${escapeHtml(profileName(profile.id))}</option>`)
    ].join("");
    if (technicians.some((profile) => profile.id === selected)) {
      select.value = selected;
    } else {
      state.viewAsTechnicianId = "";
      select.value = "";
    }
  }

  function configureRoleExperience() {
    const adminFeaturesEnabled = canUseAdminFeatures();
    const technicianPreview = isTechnicianPreview();
    const experienceProfile = technicianPreview
      ? state.profiles.find((profile) => profile.id === state.viewAsTechnicianId)
      : state.profile;

    byId("view-as-control").hidden = !isAdmin();
    byId("view-as-notice").hidden = !technicianPreview;
    byId("role-badge").textContent = technicianPreview
      ? "Técnico · solo lectura"
      : isAdmin() ? "Administrador" : "Técnico";
    byId("welcome-title").textContent = `${greetingForCurrentTime()}, ${profileName(experienceProfile?.id || state.user?.id)}`;
    byId("activity-tab").hidden = !adminFeaturesEnabled;
    byId("properties-tab").hidden = !adminFeaturesEnabled;
    byId("export-actions").hidden = !adminFeaturesEnabled;
    byId("payments-form").hidden = !adminFeaturesEnabled;
    byId("filter-user-field").hidden = !adminFeaturesEnabled;
    byId("filter-status-field").hidden = !adminFeaturesEnabled;
    byId("payments-info").textContent = adminFeaturesEnabled
      ? "Ingresar números de predio separados por coma. Se marcará la visita activa más reciente de cada uno."
      : "Consultá las visitas marcadas como abonadas y la fecha en que se registró el pago.";

    byId("visit-form-title").textContent = technicianPreview
      ? "Vista previa del formulario de visita"
      : "Registrar una visita";
    byId("visit-form").querySelectorAll("input, textarea, button").forEach((control) => {
      control.disabled = technicianPreview;
    });
  }

  async function changeTechnicianPreview(technicianId) {
    const technician = state.profiles.find((profile) =>
      profile.id === technicianId && profile.role === "technician");
    if (technicianId && !technician) {
      throw new Error("No se encontró el técnico seleccionado.");
    }

    state.viewAsTechnicianId = technicianId;
    byId("search-query").value = "";
    if (technicianId) {
      byId("filter-user").value = "";
      byId("filter-status").value = "active";
      byId("filter-from").value = "";
      byId("filter-to").value = "";
    } else {
      setAdminVisitWeek();
    }
    resetVisitForm();
    configureRoleExperience();
    setView(technicianId ? "form-view" : "search-view");
    await loadData();
  }

  function filteredVisits(activeOnly = false) {
    return filteredVisitsFrom(state.visits, activeOnly);
  }

  function filteredVisitsFrom(visits, activeOnly = false) {
    const query = normalize(byId("search-query").value.trim());
    const queryDigits = query.replace(/\D/g, "");
    const from = byId("filter-from").value;
    const to = byId("filter-to").value;
    const userId = isTechnicianPreview()
      ? state.viewAsTechnicianId
      : canUseAdminFeatures() ? byId("filter-user").value : "";
    const status = activeOnly || isTechnicianExperience()
      ? "active"
      : byId("filter-status").value;

    return visits.filter((visit) => {
      const property = propertyFor(visit.property_number);
      const parentArchived = Boolean(property?.archived_at);
      const isArchived = Boolean(visit.archived_at || parentArchived);
      if (isTechnicianExperience() && isArchived) return false;
      if (status === "active" && isArchived) return false;
      if (status === "archived" && !isArchived) return false;
      if (status === "all" && isTechnicianExperience() && isArchived) return false;
      if (from && visit.visit_date < from) return false;
      if (to && visit.visit_date > to) return false;
      if (userId && visit.created_by !== userId) return false;
      if (query) {
        const searchableText = normalize([
          visit.property_number,
          visit.contact_name,
          visit.cellphone
        ].join(" "));
        const matchesText = searchableText.includes(query);
        const matchesDigits = queryDigits.length > 0
          && String(visit.cellphone).replace(/\D/g, "").includes(queryDigits);
        if (!matchesText && !matchesDigits) return false;
      }
      return true;
    }).sort((a, b) => b.visit_date.localeCompare(a.visit_date)
      || b.created_at.localeCompare(a.created_at));
  }

  function renderVisits() {
    const results = filteredVisits();
    const container = byId("visit-results");
    byId("search-default-hint").hidden = searchUsesAllVisits();
    byId("result-count").textContent = `${results.length} ${results.length === 1 ? "visita" : "visitas"}`;

    if (!results.length) {
      container.innerHTML = '<div class="empty-state">No se encontraron visitas con esos criterios.</div>';
      return;
    }

    container.innerHTML = results.map((visit) => {
      if (isTechnicianExperience()) {
        const phone = String(visit.cellphone).replace(/\D/g, "");
        const whatsappUrl = `https://wa.me/549${phone}`;
        return `
          <article class="search-result-row">
            <strong>${escapeHtml(visit.property_number)}</strong>
            <span>${escapeHtml(formatDate(visit.visit_date))}</span>
            <span>${escapeHtml(visit.contact_name)}</span>
            <div class="search-contact">
              <span>${escapeHtml(visit.cellphone)}</span>
              <a class="contact-action whatsapp-action" href="${whatsappUrl}" target="_blank" rel="noopener noreferrer" aria-label="Abrir chat de WhatsApp con ${escapeHtml(visit.cellphone)}" title="Abrir WhatsApp">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 3.5A11.8 11.8 0 0 0 12.1 0C5.5 0 .1 5.4.1 12c0 2.1.6 4.2 1.6 6L0 24l6.2-1.6a12 12 0 0 0 5.9 1.5h.1c6.6 0 12-5.4 12-12a11.8 11.8 0 0 0-3.7-8.4Zm-8.4 18.4c-1.8 0-3.5-.5-5-1.4l-.4-.2-3.7 1 1-3.6-.3-.4A9.8 9.8 0 1 1 12.1 22Zm5.4-7.3c-.3-.2-1.8-.9-2.1-1-.3-.1-.5-.2-.7.2-.2.3-.8 1-1 1.2-.2.2-.4.2-.7.1a8.3 8.3 0 0 1-2.5-1.5 9.4 9.4 0 0 1-1.7-2.1c-.2-.3 0-.5.1-.6l.5-.6.3-.5c.1-.2 0-.4 0-.6l-1-2.3c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4-.3.4-1.2 1.2-1.2 2.8s1.2 3.2 1.4 3.4c.2.2 2.4 3.7 5.8 5.1.8.3 1.4.5 1.9.6.8.2 1.5.2 2 .1.6-.1 1.8-.8 2-1.5.3-.7.3-1.3.2-1.5 0-.2-.3-.3-.6-.5Z"/></svg>
              </a>
              <button class="contact-action copy-action" type="button" data-action="copy-phone" data-phone="${escapeHtml(visit.cellphone)}" aria-label="Copiar celular ${escapeHtml(visit.cellphone)}" title="Copiar celular">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1Zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h11v14Z"/></svg>
              </button>
            </div>
          </article>`;
      }

      const property = propertyFor(visit.property_number);
      const archived = Boolean(visit.archived_at || property?.archived_at);
      const parentArchived = Boolean(property?.archived_at);
      const canArchiveProperty = canUseAdminFeatures() && property;
      const visitButton = canUseAdminFeatures()
        ? `<button class="button button-small button-secondary" type="button" data-action="toggle-visit" data-id="${escapeHtml(visit.id)}" data-archived="${Boolean(visit.archived_at)}">${visit.archived_at ? "Restaurar visita" : "Archivar visita"}</button>`
        : "";
      const propertyButton = canArchiveProperty
        ? `<button class="button button-small button-secondary" type="button" data-action="toggle-property" data-number="${escapeHtml(visit.property_number)}" data-archived="${parentArchived}">${parentArchived ? "Restaurar predio" : "Archivar predio"}</button>`
        : "";
      const canEdit = !archived && (
        canUseAdminFeatures()
        || (!isAdmin() && visit.created_by === state.user?.id)
      );
      const editButton = canEdit
        ? `<button class="button button-small button-quiet" type="button" data-action="edit" data-id="${escapeHtml(visit.id)}">Editar</button>`
        : "";
      const canViewPayment = canUseAdminFeatures()
        || visit.created_by === (isTechnicianPreview() ? state.viewAsTechnicianId : state.user?.id);
      const paymentStatus = !canViewPayment
        ? ""
        : visit.paid_at
          ? `<p class="result-meta"><span class="state-label">Abonada</span> · ${escapeHtml(formatPaymentDate(visit.paid_at))}</p>`
          : '<p class="result-meta"><span class="state-label unpaid">Sin abonar</span></p>';

      return `
        <article class="result-card">
          <div class="result-top">
            <h3>Predio ${escapeHtml(visit.property_number)} · ${escapeHtml(formatDate(visit.visit_date))}</h3>
            <span class="state-label${archived ? " archived" : ""}">${archived ? "Archivado" : "Activo"}</span>
          </div>
          <p><strong>Contacto:</strong> ${escapeHtml(visit.contact_name)}</p>
          <p><strong>Celular:</strong> ${escapeHtml(visit.cellphone)}</p>
          ${visit.notes ? `<p class="result-notes"><strong>Notas:</strong> ${escapeHtml(visit.notes)}</p>` : ""}
          ${paymentStatus}
          <p class="result-meta">Registró ${escapeHtml(profileName(visit.created_by))} · Última edición ${escapeHtml(profileName(visit.updated_by))}</p>
          <div class="result-actions">${editButton}${visitButton}${propertyButton}</div>
        </article>`;
    }).join("");
  }

  function refreshSearchVisits() {
    window.clearTimeout(state.searchTimer);
    const requestId = ++state.searchRequestId;
    const searchingAll = searchUsesAllVisits();
    byId("search-default-hint").hidden = searchingAll;
    byId("result-count").textContent = searchingAll
      ? "Buscando en todos los registros…"
      : "Cargando tus últimas visitas…";
    byId("visit-results").innerHTML = "";

    state.searchTimer = window.setTimeout(async () => {
      try {
        const visits = attachVisiblePayments(await fetchSearchVisits());
        if (requestId !== state.searchRequestId || state.activeView !== "search-view") return;
        state.visits = visits;
        renderVisits();
      } catch (error) {
        if (requestId !== state.searchRequestId || state.activeView !== "search-view") return;
        byId("result-count").textContent = "No se pudieron cargar las visitas.";
        showNotice(`No se pudieron buscar las visitas. ${humanError(error)}`, true);
      }
    }, 250);
  }

  function renderPayments() {
    const currentDataUserId = dataUserId();
    const visiblePaidVisits = state.visits
      .filter((visit) => visit.paid_at
        && (canUseAdminFeatures() || visit.created_by === currentDataUserId))
      .sort((a, b) => b.paid_at.localeCompare(a.paid_at)
        || b.visit_date.localeCompare(a.visit_date)
        || b.created_at.localeCompare(a.created_at));
    const latestPaymentDate = visiblePaidVisits
      .map((visit) => argentinaDateKey(new Date(visit.paid_at)))
      .sort((a, b) => b.localeCompare(a))[0];
    const paidVisits = latestPaymentDate
      ? visiblePaidVisits.filter((visit) => argentinaDateKey(new Date(visit.paid_at)) === latestPaymentDate)
      : [];
    const container = byId("payments-list");
    byId("paid-visits-date").textContent = latestPaymentDate ? formatDate(latestPaymentDate) : "—";
    byId("paid-visit-count").textContent = `${paidVisits.length} ${paidVisits.length === 1 ? "visita" : "visitas"}`;

    if (!paidVisits.length) {
      container.innerHTML = '<div class="empty-state">Todavía no hay pagos registrados.</div>';
    } else {
      container.innerHTML = paidVisits.map((visit) => `
        <article class="payment-row${canUseAdminFeatures() ? " payment-row-admin" : ""}">
          <strong>${escapeHtml(visit.property_number)}</strong>
          <span class="payment-date">${escapeHtml(formatPaymentDate(visit.paid_at))}</span>
          ${canUseAdminFeatures() ? `<span class="payment-technician">${escapeHtml(profileName(visit.created_by))}</span>` : ""}
          ${canUseAdminFeatures() ? `<button class="button button-small button-secondary" type="button" data-action="correct-payment" data-id="${escapeHtml(visit.id)}">Corregir</button>` : ""}
        </article>
      `).join("");
    }

    const latestActiveVisitByProperty = new Map();
    state.visits
      .filter((visit) => {
        const property = propertyFor(visit.property_number);
        return !visit.archived_at
          && (!property || !property.archived_at);
      })
      .sort((a, b) => b.visit_date.localeCompare(a.visit_date)
        || b.created_at.localeCompare(a.created_at))
      .forEach((visit) => {
        if (!latestActiveVisitByProperty.has(visit.property_number)) {
          latestActiveVisitByProperty.set(visit.property_number, visit);
        }
      });

    const pendingVisits = [...latestActiveVisitByProperty.values()]
      .filter((visit) => !visit.paid_at
        && (canUseAdminFeatures() || visit.created_by === currentDataUserId))
      .sort((a, b) => b.visit_date.localeCompare(a.visit_date)
        || b.created_at.localeCompare(a.created_at));
    const pendingContainer = byId("pending-payments-list");
    byId("pending-visit-count").textContent = `${pendingVisits.length} ${pendingVisits.length === 1 ? "visita" : "visitas"}`;

    if (!pendingVisits.length) {
      pendingContainer.innerHTML = '<div class="empty-state">No hay visitas pendientes de pago.</div>';
      return;
    }

    pendingContainer.innerHTML = pendingVisits.map((visit) => `
      <article class="payment-row${canUseAdminFeatures() ? " payment-row-admin" : ""}">
        <strong>${escapeHtml(visit.property_number)}</strong>
        <span class="payment-date">${escapeHtml(formatDate(visit.visit_date))}</span>
        ${canUseAdminFeatures() ? `<span class="payment-technician">${escapeHtml(profileName(visit.created_by))}</span>` : ""}
      </article>
    `).join("");
  }

  function changedFields(entry) {
    if (entry.action === "INSERT") return "Registro creado.";
    if (entry.action === "DELETE") return "Registro eliminado.";
    const oldData = entry.old_data || {};
    const newData = entry.new_data || {};
    const ignored = new Set(["updated_by", "updated_at"]);
    const labels = {
      paid_at: "Fecha de pago",
      paid_by: "Procesado por",
      notes: "Notas",
      contact_name: "Contacto",
      cellphone: "Celular",
      visit_date: "Fecha de visita",
      archived_at: "Archivado",
      archived_by: "Archivado por"
    };
    const keys = [...new Set([...Object.keys(oldData), ...Object.keys(newData)])]
      .filter((key) => !ignored.has(key) && JSON.stringify(oldData[key]) !== JSON.stringify(newData[key]));
    if (!keys.length) return "Se actualizó el registro.";
    return keys.map((key) => {
      const formatValue = (value) => {
        if (value == null) return "—";
        if (key.endsWith("_by")) return profileName(value);
        if (key === "paid_at" || key.endsWith("_at")) return formatDateTime(value);
        if (key === "visit_date") return formatDate(value);
        return String(value);
      };
      return `${labels[key] || key}: ${formatValue(oldData[key])} → ${formatValue(newData[key])}`;
    }).join(" · ");
  }

  function activityEntityLabel(entry) {
    const oldData = entry.old_data || {};
    const newData = entry.new_data || {};
    const visit = entry.entity_type === "visit"
      ? state.visits.find((item) => item.id === entry.entity_id)
      : null;
    const propertyNumber = newData.property_number ?? oldData.property_number ?? visit?.property_number;
    if (entry.entity_type === "property") return `Predio ${propertyNumber ?? entry.entity_id}`;
    if (entry.entity_type === "assignment") return `Asignación del predio ${propertyNumber ?? entry.entity_id}`;
    if (propertyNumber == null) return "Visita";
    const visitDate = newData.visit_date ?? oldData.visit_date ?? visit?.visit_date;
    return `Visita del predio ${propertyNumber}${visitDate ? ` · ${formatDate(visitDate)}` : ""}`;
  }

  function renderActivity() {
    const container = byId("activity-list");
    const actionLabels = {
      INSERT: "Creación",
      UPDATE: "Actualización",
      DELETE: "Eliminación"
    };
    if (!isAdmin()) {
      container.innerHTML = "";
      return;
    }
    if (!state.audit.length) {
      container.innerHTML = '<div class="empty-state">No hay cambios registrados en los últimos 30 días.</div>';
      return;
    }
    container.innerHTML = state.audit.map((entry) => `
      <article class="activity-entry">
        <div class="activity-top">
          <strong>${escapeHtml(profileName(entry.actor_id))}</strong>
          <span class="state-label">${escapeHtml(actionLabels[entry.action] || entry.action)}</span>
          <span class="result-meta">${escapeHtml(formatDateTime(entry.changed_at))}</span>
        </div>
        <p>${escapeHtml(activityEntityLabel(entry))}</p>
        <p class="activity-change">${escapeHtml(changedFields(entry))}</p>
      </article>
    `).join("");
  }

  function renderOperationResult(containerId, result, labels) {
    const container = byId(containerId);
    const rows = Object.entries(labels).flatMap(([key, label]) => {
      const values = result[key] || [];
      if (!values.length) return [];
      return [`<li><strong>${escapeHtml(label)} (${values.length}):</strong> ${values.map((item) => {
        if (typeof item === "object" && item !== null) {
          return `${escapeHtml(item.property)}: ${escapeHtml(item.message)}`;
        }
        return escapeHtml(item);
      }).join(", ")}</li>`];
    });
    container.innerHTML = rows.length
      ? `<ul class="operation-summary">${rows.join("")}</ul>`
      : "";
  }

  function renderVisitImportResult(result) {
    const groups = [
      ["imported", "Importadas"],
      ["truncated", "Importadas con datos truncados"],
      ["invalid", "Datos inválidos"],
      ["duplicate_in_file", "Predio repetido en el archivo"],
      ["duplicate_visit", "Visita existente"],
      ["not_found", "Predio inexistente"],
      ["archived", "Predio archivado"],
      ["not_assigned", "Sin asignación activa al responsable"],
      ["future", "Fecha futura"],
      ["errors", "Errores"]
    ];
    const summaries = groups.flatMap(([key, label]) => {
      const entries = result[key] || [];
      if (!entries.length) return [];
      const lines = entries.map((entry) => {
        const property = entry.property ? ` · Predio ${entry.property}` : "";
        const reason = entry.reason ? `: ${entry.reason}` : "";
        return `<li>Fila ${escapeHtml(entry.row)}${escapeHtml(property)}${escapeHtml(reason)}</li>`;
      }).join("");
      return [`
        <section class="import-result-group">
          <h3>${escapeHtml(label)} (${entries.length})</h3>
          <ul>${lines}</ul>
        </section>
      `];
    });
    byId("visit-import-result").innerHTML = summaries.length
      ? `<div class="import-result-summary">${summaries.join("")}</div>`
      : '<div class="empty-state">No se recibieron resultados de la importación.</div>';
  }

  function renderPropertiesPanel() {
    if (!canUseAdminFeatures()) return;

    const assignee = byId("property-assignee");
    const selectedAssignee = assignee.value || state.profile?.id || "";
    assignee.innerHTML = state.profiles
      .filter((profile) => profile.role === "admin" || profile.role === "technician")
      .map((profile) => `<option value="${escapeHtml(profile.id)}">${escapeHtml(profileName(profile.id))}${profile.role === "admin" ? " · Admin" : ""}</option>`)
      .join("");
    if (state.profiles.some((profile) => profile.id === selectedAssignee)) {
      assignee.value = selectedAssignee;
    }

    const importAssignee = byId("visit-import-assignee");
    const selectedImportAssignee = importAssignee.value || state.profile?.id || "";
    importAssignee.innerHTML = state.profiles
      .filter((profile) => profile.role === "technician" || profile.role === "admin")
      .map((profile) => `<option value="${escapeHtml(profile.id)}">${escapeHtml(profileName(profile.id))}${profile.role === "admin" ? " · Admin" : ""}</option>`)
      .join("");
    if (state.profiles.some((profile) => profile.id === selectedImportAssignee
        && (profile.role === "technician" || profile.role === "admin"))) {
      importAssignee.value = selectedImportAssignee;
    }

    const rate = Number(state.trackingSettings.visits_per_workday) || 2;
    const alertDays = Number(state.trackingSettings.alert_days) || 15;
    byId("visits-per-workday").value = String(rate);
    byId("property-alert-days").value = String(alertDays);

    const orderedAssignments = [...state.assignments]
      .sort((left, right) => left.assigned_at.localeCompare(right.assigned_at));
    const latestAssignment = new Map();
    orderedAssignments.forEach((assignment) => latestAssignment.set(assignment.property_number, assignment));
    const propertiesByNumber = new Map(
      state.properties.map((property) => [property.property_number, property])
    );
    const activeAssignments = state.assignments.filter((assignment) =>
      !assignment.closed_at && !propertiesByNumber.get(assignment.property_number)?.archived_at
    );
    const pendingByUser = new Map();
    state.assignments.forEach((assignment) => {
      if (!pendingByUser.has(assignment.assigned_to)) pendingByUser.set(assignment.assigned_to, 0);
    });
    activeAssignments.forEach((assignment) => {
      pendingByUser.set(assignment.assigned_to, (pendingByUser.get(assignment.assigned_to) || 0) + 1);
    });

    const total = state.properties.length;
    const archived = state.properties.filter((property) => property.archived_at).length;
    const pending = activeAssignments.length;
    const visited = state.properties.filter((property) =>
      !property.archived_at && latestAssignment.get(property.property_number)?.completed_at
    ).length;
    const unassigned = state.properties.filter((property) =>
      !property.archived_at && !latestAssignment.has(property.property_number)
    ).length;
    byId("property-summary").innerHTML = [
      ["En inventario", total],
      ["Pendientes", pending],
      ["Visitados", visited],
      ["Sin asignar", unassigned],
      ["Archivados", archived]
    ].map(([label, value]) => `
      <div class="property-stat"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>
    `).join("");

    const alerts = [...pendingByUser.entries()]
      .map(([userId, count]) => ({ userId, count, days: Math.ceil(count / rate) }))
      .filter((item) => item.days <= alertDays)
      .sort((left, right) => left.days - right.days || left.count - right.count);
    byId("property-alerts").innerHTML = alerts.length
      ? alerts.map((item) => `
        <article class="property-alert">
          <strong>${escapeHtml(profileName(item.userId))}</strong>
          <span>${item.count
            ? `${item.count} ${item.count === 1 ? "predio pendiente" : "predios pendientes"}`
            : "Sin predios pendientes"}</span>
          <span>${item.days
            ? `Cobertura estimada: ${item.days} ${item.days === 1 ? "día hábil" : "días hábiles"}`
            : "Cobertura agotada"}</span>
        </article>
      `).join("")
      : '<div class="empty-state">No hay responsables dentro del umbral de alerta configurado.</div>';

    const filter = byId("property-status-filter").value;
    const inventory = state.properties.filter((property) => {
      if (filter === "archived") return Boolean(property.archived_at);
      if (property.archived_at) return false;
      const assignment = latestAssignment.get(property.property_number);
      if (filter === "pending") return Boolean(assignment && !assignment.closed_at);
      if (filter === "visited") return Boolean(assignment?.completed_at);
      if (filter === "unassigned") return !assignment;
      return true;
    }).sort((left, right) => left.property_number - right.property_number);

    byId("property-inventory").innerHTML = inventory.length
      ? inventory.map((property) => {
        const assignment = latestAssignment.get(property.property_number);
        const status = property.archived_at
          ? "Archivado"
          : assignment && !assignment.closed_at ? "Pendiente"
            : assignment?.completed_at ? "Visitado" : "Sin asignar";
        const responsible = assignment ? profileName(assignment.assigned_to) : "—";
        return `
          <article class="property-inventory-row">
            <strong>${escapeHtml(property.property_number)}</strong>
            <span class="property-status status-${status.toLocaleLowerCase("es").replaceAll(" ", "-")}">${escapeHtml(status)}</span>
            <span>${escapeHtml(responsible)}</span>
            <span>${assignment ? escapeHtml(formatDate(assignment.assigned_at)) : "—"}</span>
          </article>
        `;
      }).join("")
      : '<div class="empty-state">No hay predios para este filtro.</div>';
  }

  async function importVisits(event) {
    event.preventDefault();
    if (!canUseAdminFeatures() || state.busy) return;

    const file = byId("visit-import-file").files[0];
    const assigneeId = byId("visit-import-assignee").value;
    if (!file) {
      showNotice("Seleccioná un archivo CSV.", true);
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showNotice("El archivo supera el límite de 5 MB.", true);
      return;
    }

    let rows;
    try {
      rows = parseCsv(await file.text());
    } catch (error) {
      showNotice(error.message || "No se pudo leer el archivo CSV.", true);
      return;
    }
    if (!rows.length) {
      showNotice("El archivo no contiene filas de visitas.", true);
      return;
    }
    if (!window.confirm(
      `Se revisarán ${rows.length} filas para ${profileName(assigneeId)}. ` +
      "Las visitas importadas completarán la asignación activa de cada predio. " +
      "Las filas inválidas o no asignadas se informarán sin cancelar las demás. ¿Continuar?"
    )) return;

    byId("visit-import-result").innerHTML = "";
    setBusy(true);
    clearNotice();
    try {
      const { data, error } = await state.client.rpc("import_visits", {
        p_assigned_to: assigneeId,
        p_rows: rows
      });
      if (error) throw error;
      renderVisitImportResult(data);
      byId("visit-import-file").value = "";
      const importedCount = data?.imported?.length || 0;
      const rejectedCount = rows.length - importedCount;
      const completionMessage =
        `Importación finalizada: ${importedCount} ${importedCount === 1 ? "visita importada" : "visitas importadas"}` +
        `${rejectedCount ? ` y ${rejectedCount} ${rejectedCount === 1 ? "fila rechazada" : "filas rechazadas"}` : ""}.`;
      try {
        await loadData();
        showNotice(completionMessage);
      } catch (error) {
        showNotice(`${completionMessage} No se pudo actualizar el panel: ${humanError(error)}`, true);
      }
    } catch (error) {
      showNotice(humanError(error), true);
    } finally {
      setBusy(false);
    }
  }

  function downloadVisitImportTemplate() {
    const content = "\uFEFFPredio,Notas,Fecha,Contacto,Celular\r\n";
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "plantilla-importacion-visitas.csv";
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function addProperties(event) {
    event.preventDefault();
    if (!canUseAdminFeatures() || state.busy) return;
    const numbers = parsePropertyList(byId("property-add-list").value);
    if (!numbers.length) {
      showNotice("Ingresá al menos un número de predio.", true);
      return;
    }

    byId("property-add-result").innerHTML = "";
    setBusy(true);
    clearNotice();
    try {
      const { data, error } = await state.client.rpc("add_properties", {
        p_property_numbers: numbers
      });
      if (error) throw error;
      renderOperationResult("property-add-result", data, {
        added: "Agregados",
        existing: "Ya existían",
        duplicates: "Repetidos en la lista",
        invalid: "Formato inválido",
        errors: "Errores"
      });
      await loadData();
      byId("property-add-list").value = "";
      const count = data?.added?.length || 0;
      showNotice(`Proceso completado: ${count} ${count === 1 ? "predio agregado" : "predios agregados"}.`);
    } catch (error) {
      showNotice(humanError(error), true);
    } finally {
      setBusy(false);
    }
  }

  async function assignProperties(event) {
    event.preventDefault();
    if (!canUseAdminFeatures() || state.busy) return;
    const numbers = parsePropertyList(byId("property-assign-list").value);
    if (!numbers.length) {
      showNotice("Ingresá al menos un número de predio.", true);
      return;
    }
    const targetAssignee = byId("property-assignee").value;
    const assignmentsByProperty = new Map(
      state.assignments
        .filter((assignment) => !assignment.closed_at)
        .map((assignment) => [String(assignment.property_number), assignment])
    );
    const toReassign = [...new Set(numbers)].flatMap((number) => {
      const current = assignmentsByProperty.get(number);
      return current && current.assigned_to !== targetAssignee
        ? [`${number} (${profileName(current.assigned_to)})`]
        : [];
    });
    if (toReassign.length && !window.confirm(
      `Estos predios ya tienen otro responsable: ${toReassign.join(", ")}. ` +
      "Si continuás, se cerrará la asignación actual y se conservará en el historial. ¿Querés continuar?"
    )) return;

    byId("property-assign-result").innerHTML = "";
    setBusy(true);
    clearNotice();
    try {
      const { data, error } = await state.client.rpc("assign_properties", {
        p_property_numbers: numbers,
        p_assigned_to: targetAssignee
      });
      if (error) throw error;
      renderOperationResult("property-assign-result", data, {
        assigned: "Asignados",
        reassigned: "Reasignados",
        already_assigned: "Ya estaban asignados a esa persona",
        not_found: "No existen o están archivados",
        duplicates: "Repetidos en la lista",
        invalid: "Formato inválido",
        errors: "Errores"
      });
      await loadData();
      byId("property-assign-list").value = "";
      const count = (data?.assigned?.length || 0) + (data?.reassigned?.length || 0);
      showNotice(`Proceso completado: ${count} ${count === 1 ? "predio asignado" : "predios asignados"}.`);
    } catch (error) {
      showNotice(humanError(error), true);
    } finally {
      setBusy(false);
    }
  }

  async function savePropertyTrackingSettings(event) {
    event.preventDefault();
    if (!canUseAdminFeatures() || state.busy) return;
    const visitsPerWorkday = Number(byId("visits-per-workday").value);
    const alertDays = Number(byId("property-alert-days").value);
    if (!Number.isInteger(visitsPerWorkday) || visitsPerWorkday < 1
        || !Number.isInteger(alertDays) || alertDays < 1) {
      showNotice("Los parámetros deben ser números enteros mayores que cero.", true);
      return;
    }

    setBusy(true);
    clearNotice();
    try {
      const { data, error } = await state.client.rpc("update_property_tracking_settings", {
        p_visits_per_workday: visitsPerWorkday,
        p_alert_days: alertDays
      });
      if (error) throw error;
      state.trackingSettings = data;
      await loadData();
      showNotice("Los parámetros de cobertura se guardaron correctamente.");
    } catch (error) {
      showNotice(humanError(error), true);
    } finally {
      setBusy(false);
    }
  }

  async function openApplication(user) {
    await refreshMaintenanceStatus();
    state.user = user;
    const { data, error } = await state.client
      .from("profiles")
      .select("id,email,display_name,role")
      .eq("id", user.id)
      .single();
    if (error) {
      await refreshMaintenanceStatus();
      if (state.maintenanceEnabled) {
        await closeSessionForMaintenance();
        return false;
      }
      throw error;
    }
    state.profile = data;
    if (state.maintenanceEnabled && !isAdmin()) {
      await closeSessionForMaintenance();
      return false;
    }
    byId("login-panel").hidden = true;
    byId("application").hidden = false;
    byId("session-area").hidden = false;
    byId("session-email").textContent = profileName(data.id);
    if (isAdmin()) setAdminVisitWeek();
    else byId("filter-status").value = "active";
    setVisitDateLimit();
    byId("visit-date").value = localDateInputValue();
    resetVisitForm();
    setView(isAdmin() ? "search-view" : "form-view");
    await loadData();
    if (!isAdmin()) focusPropertyNumber();
    return true;
  }

  function resetVisitForm() {
    byId("visit-form").reset();
    setVisitDateLimit();
    byId("visit-date").value = localDateInputValue();
    byId("property-number").disabled = false;
    byId("visit-form-title").textContent = "Registrar una visita";
    byId("save-visit").textContent = "Guardar visita";
    byId("cancel-edit").hidden = true;
    byId("edit-hint").hidden = true;
    byId("notes-count").textContent = "0";
    state.editingId = null;
  }

  function beginEdit(id) {
    if (isTechnicianPreview()) {
      showNotice("La vista de técnico es de solo lectura.", true);
      return;
    }
    const visit = state.visits.find((item) => item.id === id);
    if (!visit || visit.archived_at || propertyFor(visit.property_number)?.archived_at) {
      showNotice("La visita no está activa y no se puede editar.", true);
      return;
    }
    if (!isAdmin() && visit.created_by !== state.user?.id) {
      showNotice("Solo podés editar las visitas que registraste.", true);
      return;
    }
    state.editingId = id;
    byId("property-number").value = visit.property_number;
    byId("property-number").disabled = true;
    byId("visit-date").value = visit.visit_date;
    byId("contact-name").value = visit.contact_name;
    byId("cellphone").value = visit.cellphone;
    byId("notes").value = visit.notes || "";
    byId("notes-count").textContent = String((visit.notes || "").length);
    byId("visit-form-title").textContent = `Editar visita del predio ${visit.property_number}`;
    byId("save-visit").textContent = "Guardar cambios";
    byId("cancel-edit").hidden = false;
    byId("edit-hint").hidden = false;
    clearNotice();
    setView("form-view");
    byId("contact-name").focus();
  }

  async function saveVisit(event) {
    event.preventDefault();
    if (isTechnicianPreview()) {
      showNotice("La vista de técnico es de solo lectura.", true);
      return;
    }
    if (state.busy) return;
    clearNotice();
    const form = event.currentTarget;
    setVisitDateLimit();
    if (!form.reportValidity()) return;

    const payload = {
      visit_date: byId("visit-date").value,
      contact_name: byId("contact-name").value.trim(),
      cellphone: byId("cellphone").value,
      notes: byId("notes").value.trim() || null
    };

    setBusy(true);
    try {
      if (state.editingId) {
        const { error } = await state.client.from("visits")
          .update(payload)
          .eq("id", state.editingId)
          .select("id")
          .single();
        if (error) throw error;
        resetVisitForm();
        await loadData();
        showVisitSuccess("Los cambios de la visita se guardaron correctamente.");
        focusPropertyNumber();
      } else {
        const { error } = await state.client.rpc("create_visit", {
          p_property_number: Number(byId("property-number").value),
          p_visit_date: payload.visit_date,
          p_contact_name: payload.contact_name,
          p_cellphone: payload.cellphone,
          p_notes: payload.notes
        });
        if (error) throw error;
        resetVisitForm();
        await loadData();
        showVisitSuccess("La visita se registró correctamente.");
        focusPropertyNumber();
      }
    } catch (error) {
      showNotice(humanError(error), true);
    } finally {
      setBusy(false);
    }
  }

  function humanError(error) {
    const message = [error?.message, error?.details, error?.hint]
      .filter(Boolean)
      .join(" ");
    const normalizedMessage = message.toLocaleLowerCase("en");
    if (message.includes("visits_property_number_visit_date_key")) {
      return "Ya existe una visita para ese predio en esa fecha. Buscala y editá el registro existente.";
    }
    if (message.includes("cellphone_check") || message.includes("visits_cellphone_check")) {
      return "El celular debe tener exactamente 10 dígitos, comenzar con un número del 1 al 9 y no incluir 0 ni 15.";
    }
    if (message.includes("contact_name_check") || message.includes("visits_contact_name_check")) {
      return "El nombre de contacto es obligatorio y admite hasta 50 caracteres.";
    }
    if (message.includes("Visit date cannot be in the future")) {
      return "La fecha de visita no puede ser futura.";
    }
    if (message.includes("This property is archived")) {
      return "El predio está archivado. Pedile al administrador que lo restaure antes de cargar una visita.";
    }
    if (message.includes("This property is not assigned to your account")) {
      return "Ese predio no está asignado a tu usuario. Pedile al administrador que lo asigne antes de registrar la visita.";
    }
    if (
      normalizedMessage.includes("property could not be created")
      || normalizedMessage.includes("property does not exist")
      || normalizedMessage.includes("property not found")
    ) {
      return "No tienes asignado el predio o el mismo no existe.";
    }
    if (message.includes("Invalid login credentials")) {
      return "El correo o la contraseña no son correctos.";
    }
    return message || "Ocurrió un error inesperado. Intentá nuevamente.";
  }

  async function toggleArchive(button) {
    if (!canUseAdminFeatures()) return;
    const archived = button.dataset.archived === "true";
    const action = archived ? "restaurar" : "archivar";
    const type = button.dataset.action === "toggle-property" ? "predio" : "visita";
    if (!window.confirm(`¿Querés ${action} este ${type}?`)) return;

    setBusy(true);
    clearNotice();
    try {
      let result;
      if (type === "predio") {
        result = await state.client.from("properties")
          .update({ archived_at: archived ? null : new Date().toISOString() })
          .eq("property_number", Number(button.dataset.number))
          .select("property_number")
          .single();
      } else {
        result = await state.client.from("visits")
          .update({ archived_at: archived ? null : new Date().toISOString() })
          .eq("id", button.dataset.id)
          .select("id")
          .single();
      }
      if (result.error) throw result.error;
      await loadData();
      showNotice(`El ${type} se ${archived ? "restauró" : "archivó"} correctamente.`);
    } catch (error) {
      showNotice(humanError(error), true);
    } finally {
      setBusy(false);
    }
  }

  function csvEscape(value) {
    return `"${String(value ?? "").replace(/"/g, '""')}"`;
  }

  function exportCsv(visits, label) {
    if (!canUseAdminFeatures()) {
      showNotice("Solo el administrador puede exportar datos.", true);
      return;
    }
    const headings = ["Predio", "Fecha", "Nombre", "Celular", "Notas", "Estado", "Abonada", "Fecha de pago", "Creado por", "Creado", "Última edición por", "Última edición"];
    const rows = visits.map((visit) => {
      const archived = Boolean(visit.archived_at || propertyFor(visit.property_number)?.archived_at);
      return [
        visit.property_number,
        formatDate(visit.visit_date),
        visit.contact_name,
        visit.cellphone,
        visit.notes || "",
        archived ? "Archivado" : "Activo",
        visit.paid_at ? "Sí" : "No",
        visit.paid_at ? formatPaymentDate(visit.paid_at) : "",
        profileName(visit.created_by),
        formatDateTime(visit.created_at),
        profileName(visit.updated_by),
        formatDateTime(visit.updated_at)
      ];
    });
    const csv = "\uFEFF" + [headings, ...rows].map((row) => row.map(csvEscape).join(";")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `eod-${label}-${localDateInputValue()}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showNotice(`Se exportaron ${visits.length} ${visits.length === 1 ? "visita" : "visitas"} a CSV.`);
  }

  async function exportAllActiveVisits() {
    if (!canUseAdminFeatures()) return;
    try {
      const visits = attachVisiblePayments(await fetchAllVisits());
      exportCsv(filteredVisitsFrom(visits, true), "todos-activos");
    } catch (error) {
      showNotice(`No se pudieron cargar todas las visitas para exportar. ${humanError(error)}`, true);
    }
  }

  function paymentIssue(propertyNumber, status, result) {
    if (status === "invalid") return `“${propertyNumber}” no tiene el formato de un predio de 6 dígitos sin cero inicial.`;
    if (status === "not_found") return `El predio ${propertyNumber} no existe.`;
    if (status === "property_archived") return `El predio ${propertyNumber} está archivado.`;
    if (status === "no_visit") return `El predio ${propertyNumber} no tiene visitas activas.`;
    if (status === "already_paid") {
      return `La visita más reciente del predio ${propertyNumber} ya figura abonada el ${formatPaymentDate(result.paid_at)}.`;
    }
    return `No se pudo procesar el predio ${propertyNumber}.`;
  }

  async function processPayments(event) {
    event.preventDefault();
    if (state.busy || !canUseAdminFeatures()) return;

    const propertyNumbers = byId("payment-property-list").value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (!propertyNumbers.length) {
      showNotice("Ingresá al menos un número de predio.", true);
      return;
    }

    clearNotice();
    setBusy(true);
    const processed = [];
    let stoppedAt = null;
    let requestError = null;

    try {
      for (const token of propertyNumbers) {
        if (!/^[1-9][0-9]{5}$/.test(token)) {
          const issue = paymentIssue(token, "invalid");
          if (!window.confirm(`${issue}\n\n¿Querés continuar con los demás predios?`)) {
            stoppedAt = token;
            break;
          }
          processed.push({ propertyNumber: token, status: "skipped" });
          continue;
        }

        const { data, error } = await state.client.rpc("mark_latest_visit_paid", {
          p_property_number: Number(token)
        });
        if (error) {
          requestError = error;
          break;
        }
        if (!data || !["marked", "not_found", "property_archived", "no_visit", "already_paid"].includes(data.status)) {
          requestError = new Error("Supabase devolvió una respuesta inesperada al procesar el pago.");
          break;
        }

        if (data.status === "marked") {
          processed.push({ propertyNumber: token, status: "marked" });
          continue;
        }

        const issue = paymentIssue(token, data.status, data);
        if (!window.confirm(`${issue}\n\n¿Querés continuar con los demás predios?`)) {
          stoppedAt = token;
          break;
        }
        processed.push({ propertyNumber: token, status: "skipped" });
      }

      await loadData();
    } catch (error) {
      requestError = error;
    } finally {
      setBusy(false);
    }

    const markedCount = processed.filter((item) => item.status === "marked").length;
    if (requestError) {
      showNotice(`Se marcaron ${markedCount} visita(s) antes del error. ${humanError(requestError)}`, true);
      return;
    }
    if (markedCount) byId("payment-property-list").value = "";

    const stopMessage = stoppedAt
      ? ` Proceso detenido en ${stoppedAt}; los pagos anteriores no se revierten.`
      : "";
    showNotice(`Proceso finalizado: ${markedCount} visita(s) marcada(s) como abonadas.${stopMessage}`);
  }

  async function correctPayment(visitId) {
    if (!canUseAdminFeatures() || state.busy) return;
    const visit = state.visits.find((item) => item.id === visitId);
    if (!visit?.paid_at) return;
    if (!window.confirm(`¿Querés quitar la marca de pago del predio ${visit.property_number}? Esta corrección quedará registrada en la auditoría.`)) {
      return;
    }

    setBusy(true);
    clearNotice();
    try {
      const { error } = await state.client.from("visits")
        .update({ paid_at: null })
        .eq("id", visitId)
        .select("id")
        .single();
      if (error) throw error;
      await loadData();
      showNotice(`Se corrigió el pago del predio ${visit.property_number}.`);
    } catch (error) {
      showNotice(humanError(error), true);
    } finally {
      setBusy(false);
    }
  }

  async function copyPhone(phone) {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("El navegador no permite copiar al portapapeles desde esta página.");
      }
      await navigator.clipboard.writeText(phone);
      showNotice(`Se copió el celular ${phone}.`);
    } catch (error) {
      showNotice(error.message || "No se pudo copiar el celular.", true);
    }
  }

  function bindEvents() {
    byId("login-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (state.busy) return;
      setBusy(true);
      clearNotice();
      try {
        const { data, error } = await state.client.auth.signInWithPassword({
          email: byId("login-email").value.trim(),
          password: byId("login-password").value
        });
        if (error) throw error;
        await openApplication(data.user);
      } catch (error) {
        showNotice(humanError(error), true);
        byId("login-panel").hidden = false;
      } finally {
        setBusy(false);
      }
    });

    byId("visit-form").addEventListener("submit", saveVisit);
    byId("payments-form").addEventListener("submit", processPayments);
    byId("property-add-form").addEventListener("submit", addProperties);
    byId("property-assign-form").addEventListener("submit", assignProperties);
    byId("property-settings-form").addEventListener("submit", savePropertyTrackingSettings);
    byId("visit-import-form").addEventListener("submit", importVisits);
    byId("visit-import-template").addEventListener("click", downloadVisitImportTemplate);
    byId("property-status-filter").addEventListener("change", renderPropertiesPanel);
    byId("sign-out").addEventListener("click", async () => {
      setBusy(true);
      try {
        const { error } = await state.client.auth.signOut();
        if (error) throw error;
        showLoggedOut();
        clearNotice();
        await checkForAppUpdate();
      } catch (error) {
        showNotice(humanError(error), true);
      } finally {
        setBusy(false);
      }
    });

    document.querySelectorAll(".tab-button").forEach((button) => {
      button.addEventListener("click", async () => {
        clearNotice();
        hideVisitSuccess();
        setView(button.dataset.view);
        try {
          await loadData();
          if (button.dataset.view === "form-view" && !state.editingId && !isTechnicianPreview()) {
            focusPropertyNumber();
          }
        } catch (error) {
          showNotice(`No se pudieron actualizar los datos de esta sección. ${humanError(error)}`, true);
        }
      });
    });

    ["search-query", "filter-from", "filter-to", "filter-user", "filter-status"].forEach((id) => {
      byId(id).addEventListener(id === "search-query" ? "input" : "change", refreshSearchVisits);
    });

    byId("notes").addEventListener("input", (event) => {
      byId("notes-count").textContent = String(event.target.value.length);
    });
    byId("visit-date").addEventListener("focus", setVisitDateLimit);
    byId("property-number").addEventListener("input", hideVisitSuccess);
    byId("cancel-edit").addEventListener("click", resetVisitForm);
    byId("visit-results").addEventListener("click", (event) => {
      const actionElement = event.target.closest("[data-action]");
      if (!actionElement) return;
      if (actionElement.dataset.action === "copy-phone") copyPhone(actionElement.dataset.phone);
      else if (actionElement.dataset.action === "edit") beginEdit(actionElement.dataset.id);
      else if (actionElement instanceof HTMLButtonElement) toggleArchive(actionElement);
    });
    byId("payments-list").addEventListener("click", (event) => {
      const button = event.target.closest('button[data-action="correct-payment"]');
      if (button) correctPayment(button.dataset.id);
    });
    byId("export-filtered").addEventListener("click", () => exportCsv(filteredVisits(), "filtrados"));
    byId("export-all").addEventListener("click", exportAllActiveVisits);
    byId("view-as-technician").addEventListener("change", async (event) => {
      if (state.busy || !isAdmin()) return;
      setBusy(true);
      clearNotice();
      try {
        await changeTechnicianPreview(event.currentTarget.value);
      } catch (error) {
        showNotice(`No se pudo cambiar la vista. ${humanError(error)}`, true);
      } finally {
        setBusy(false);
      }
    });
  }

  async function start() {
    bindEvents();
    window.setInterval(checkForAppUpdate, 30000);
    document.addEventListener("visibilitychange", checkForAppUpdate);
    const developmentMode = new URLSearchParams(window.location.search).get("env") === "dev";
    if (developmentMode) {
      config = null;
      try {
        await new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "config.dev.js";
          script.onload = resolve;
          script.onerror = () => reject(new Error(
            "No se pudo cargar config.dev.js. Creá el archivo con la URL y la clave pública del proyecto EOD-dev."
          ));
          document.head.append(script);
        });
        config = window.EOD_CONFIG;
      } catch (error) {
        byId("setup-panel").hidden = false;
        throw error;
      }
    }

    const configured = config?.supabaseUrl && config?.supabaseAnonKey
      && !config.supabaseUrl.includes("YOUR-PROJECT")
      && !config.supabaseAnonKey.includes("YOUR-ANON-KEY");
    if (!configured || !window.supabase?.createClient) {
      byId("setup-panel").hidden = false;
      return;
    }

    const recoveryLink = new URLSearchParams(window.location.hash.slice(1)).get("type") === "recovery";
    if (recoveryLink) {
      history.replaceState(null, document.title, `${window.location.pathname}${window.location.search}`);
    }
    state.client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
    byId("login-panel").hidden = false;
    if (recoveryLink) {
      showNotice("La recuperación de contraseña no está disponible en EOD. Contactá al administrador.");
    }

    startMaintenanceChecks();
    await refreshMaintenanceStatus();

    state.client.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") showLoggedOut();
    });

    const { data, error } = await state.client.auth.getSession();
    if (error) {
      showNotice(humanError(error), true);
      return;
    }
    if (data.session?.user) {
      byId("login-panel").hidden = true;
      try {
        await openApplication(data.session.user);
      } catch (loadError) {
        const { error: signOutError } = await state.client.auth.signOut();
        showLoggedOut();
        showNotice(
          signOutError
            ? `${humanError(loadError)} No se pudo cerrar la sesión: ${humanError(signOutError)}`
            : humanError(loadError),
          true
        );
      }
    }
  }

  start().catch((error) => {
    showNotice(humanError(error), true);
  });
})();
