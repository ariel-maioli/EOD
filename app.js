(() => {
  "use strict";

  const config = window.EOD_CONFIG;
  const byId = (id) => document.getElementById(id);
  const state = {
    client: null,
    user: null,
    profile: null,
    activeView: null,
    visits: [],
    paymentDetails: new Map(),
    properties: [],
    profiles: [],
    audit: [],
    editingId: null,
    recoveryMode: false,
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

  function isFridayDateKey(dateKey) {
    const [year, month, day] = dateKey.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 5;
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

  function isAdmin() {
    return state.profile?.role === "admin";
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
    byId("recovery-panel").hidden = true;
    byId("login-form").hidden = false;
    byId("forgot-password-form").hidden = true;
    byId("show-forgot-password").hidden = false;
    byId("login-password").value = "";
    state.recoveryMode = false;
    state.user = null;
    state.profile = null;
    state.activeView = null;
    state.visits = [];
    state.paymentDetails = new Map();
    state.properties = [];
    state.profiles = [];
    state.audit = [];
    state.editingId = null;
  }

  function showRecoveryPanel() {
    state.recoveryMode = true;
    byId("application").hidden = true;
    byId("login-panel").hidden = true;
    byId("recovery-panel").hidden = false;
    byId("session-area").hidden = true;
  }

  function showForgotPasswordForm() {
    clearNotice();
    byId("login-form").hidden = true;
    byId("show-forgot-password").hidden = true;
    byId("forgot-password-form").hidden = false;
    byId("recovery-email").value = byId("login-email").value.trim();
    byId("recovery-email").focus();
  }

  function recoveryRedirectUrl() {
    return `${window.location.origin}${window.location.pathname}`;
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
      || (isAdmin() && byId("filter-user").value)
      || (isAdmin() && byId("filter-status").value !== "active")
    );
  }

  async function fetchSearchVisits() {
    if (searchUsesAllVisits()) return fetchAllVisits();

    const { data, error } = await orderedVisitsQuery()
      .eq("created_by", state.user.id)
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
    const [paymentsResult, propertiesResult, profilesResult] = await Promise.all([
      state.client.rpc("get_visible_visit_payments"),
      state.client.from("properties").select("*"),
      state.client.from("profiles").select("id,email,display_name,role")
    ]);

    const failure = [paymentsResult, propertiesResult, profilesResult].find((result) => result.error);
    if (failure) throw failure.error;

    state.paymentDetails = new Map(
      (paymentsResult.data || []).map((payment) => [payment.visit_id, payment])
    );
    state.properties = propertiesResult.data || [];
    state.profiles = profilesResult.data || [];

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
  }

  function renderUserFilter() {
    const select = byId("filter-user");
    const selected = select.value;
    const options = ['<option value="">Todos</option>'];
    state.profiles
      .slice()
      .sort((a, b) => profileName(a.id).localeCompare(profileName(b.id), "es"))
      .forEach((profile) => {
        options.push(`<option value="${escapeHtml(profile.id)}">${escapeHtml(profileName(profile.id))}</option>`);
      });
    select.innerHTML = options.join("");
    if (state.profiles.some((profile) => profile.id === selected)) select.value = selected;
  }

  function filteredVisits(activeOnly = false) {
    return filteredVisitsFrom(state.visits, activeOnly);
  }

  function filteredVisitsFrom(visits, activeOnly = false) {
    const query = normalize(byId("search-query").value.trim());
    const queryDigits = query.replace(/\D/g, "");
    const from = byId("filter-from").value;
    const to = byId("filter-to").value;
    const userId = isAdmin() ? byId("filter-user").value : "";
    const status = activeOnly || !isAdmin() ? "active" : byId("filter-status").value;

    return visits.filter((visit) => {
      const property = propertyFor(visit.property_number);
      const parentArchived = Boolean(property?.archived_at);
      const isArchived = Boolean(visit.archived_at || parentArchived);
      if (!isAdmin() && (!property || isArchived)) return false;
      if (status === "active" && isArchived) return false;
      if (status === "archived" && !isArchived) return false;
      if (status === "all" && !isAdmin() && isArchived) return false;
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
      if (!isAdmin()) {
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
      const canArchiveProperty = isAdmin() && property;
      const visitButton = isAdmin()
        ? `<button class="button button-small button-secondary" type="button" data-action="toggle-visit" data-id="${escapeHtml(visit.id)}" data-archived="${Boolean(visit.archived_at)}">${visit.archived_at ? "Restaurar visita" : "Archivar visita"}</button>`
        : "";
      const propertyButton = canArchiveProperty
        ? `<button class="button button-small button-secondary" type="button" data-action="toggle-property" data-number="${escapeHtml(visit.property_number)}" data-archived="${parentArchived}">${parentArchived ? "Restaurar predio" : "Archivar predio"}</button>`
        : "";
      const canEdit = !archived && (isAdmin() || visit.created_by === state.user?.id);
      const editButton = canEdit
        ? `<button class="button button-small button-quiet" type="button" data-action="edit" data-id="${escapeHtml(visit.id)}">Editar</button>`
        : "";
      const canViewPayment = isAdmin() || visit.created_by === state.user?.id;
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
    const visiblePaidVisits = state.visits
      .filter((visit) => visit.paid_at
        && (isAdmin() || visit.created_by === state.user?.id))
      .sort((a, b) => b.paid_at.localeCompare(a.paid_at)
        || b.visit_date.localeCompare(a.visit_date)
        || b.created_at.localeCompare(a.created_at));
    const fridayDate = visiblePaidVisits
      .map((visit) => argentinaDateKey(new Date(visit.paid_at)))
      .filter(isFridayDateKey)
      .sort((a, b) => b.localeCompare(a))[0];
    const paidVisits = fridayDate
      ? visiblePaidVisits.filter((visit) => argentinaDateKey(new Date(visit.paid_at)) === fridayDate)
      : [];
    const container = byId("payments-list");
    byId("paid-visits-date").textContent = fridayDate ? formatDate(fridayDate) : "—";
    byId("paid-visit-count").textContent = `${paidVisits.length} ${paidVisits.length === 1 ? "visita" : "visitas"}`;

    if (!paidVisits.length) {
      container.innerHTML = '<div class="empty-state">Todavía no hay pagos registrados en viernes.</div>';
    } else {
      container.innerHTML = paidVisits.map((visit) => `
        <article class="payment-row${isAdmin() ? " payment-row-admin" : ""}">
          <strong>${escapeHtml(visit.property_number)}</strong>
          <span class="payment-date">${escapeHtml(formatPaymentDate(visit.paid_at))}</span>
          ${isAdmin() ? `<span class="payment-technician">${escapeHtml(profileName(visit.created_by))}</span>` : ""}
          ${isAdmin() ? `<button class="button button-small button-secondary" type="button" data-action="correct-payment" data-id="${escapeHtml(visit.id)}">Corregir</button>` : ""}
        </article>
      `).join("");
    }

    const latestActiveVisitByProperty = new Map();
    state.visits
      .filter((visit) => {
        const property = propertyFor(visit.property_number);
        return !visit.archived_at
          && property
          && !property.archived_at;
      })
      .sort((a, b) => b.visit_date.localeCompare(a.visit_date)
        || b.created_at.localeCompare(a.created_at))
      .forEach((visit) => {
        if (!latestActiveVisitByProperty.has(visit.property_number)) {
          latestActiveVisitByProperty.set(visit.property_number, visit);
        }
      });

    const pendingVisits = [...latestActiveVisitByProperty.values()]
      .filter((visit) => !visit.paid_at && (isAdmin() || visit.created_by === state.user?.id))
      .sort((a, b) => b.visit_date.localeCompare(a.visit_date)
        || b.created_at.localeCompare(a.created_at));
    const recentPendingVisits = pendingVisits.slice(0, 15);
    const pendingContainer = byId("pending-payments-list");
    byId("pending-visit-count").textContent = pendingVisits.length > 15
      ? `Últimas 15 de ${pendingVisits.length}`
      : `${pendingVisits.length} ${pendingVisits.length === 1 ? "visita" : "visitas"}`;

    if (!recentPendingVisits.length) {
      pendingContainer.innerHTML = '<div class="empty-state">No hay visitas pendientes de pago.</div>';
      return;
    }

    pendingContainer.innerHTML = recentPendingVisits.map((visit) => `
      <article class="payment-row${isAdmin() ? " payment-row-admin" : ""}">
        <strong>${escapeHtml(visit.property_number)}</strong>
        <span class="payment-date">${escapeHtml(formatDate(visit.visit_date))}</span>
        ${isAdmin() ? `<span class="payment-technician">${escapeHtml(profileName(visit.created_by))}</span>` : ""}
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

  async function openApplication(user) {
    state.user = user;
    const { data, error } = await state.client
      .from("profiles")
      .select("id,email,display_name,role")
      .eq("id", user.id)
      .single();
    if (error) throw error;
    state.profile = data;
    byId("login-panel").hidden = true;
    byId("application").hidden = false;
    byId("session-area").hidden = false;
    byId("session-email").textContent = profileName(data.id);
    byId("welcome-title").textContent = `${greetingForCurrentTime()}, ${profileName(data.id)}`;
    byId("role-badge").textContent = data.role === "admin" ? "Administrador" : "Técnico";
    byId("activity-tab").hidden = !isAdmin();
    byId("export-actions").hidden = !isAdmin();
    byId("payments-form").hidden = !isAdmin();
    byId("filter-user-field").hidden = !isAdmin();
    byId("filter-status-field").hidden = !isAdmin();
    byId("payments-info").textContent = isAdmin()
      ? "Ingresar números de predio separados por coma. Se marcará la visita activa más reciente de cada uno."
      : "Consultá las visitas marcadas como abonadas y la fecha en que se registró el pago.";
    byId("filter-status").value = "active";
    setVisitDateLimit();
    byId("visit-date").value = localDateInputValue();
    setView(isAdmin() ? "activity-view" : "form-view");
    await loadData();
    if (!isAdmin()) focusPropertyNumber();
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
    const message = String(error?.message || "");
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
    if (message.includes("Invalid login credentials")) {
      return "El correo o la contraseña no son correctos.";
    }
    return message || "Ocurrió un error inesperado. Intentá nuevamente.";
  }

  async function toggleArchive(button) {
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
    if (!isAdmin()) {
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
    if (state.busy || !isAdmin()) return;

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
    if (!isAdmin() || state.busy) return;
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

    byId("show-forgot-password").addEventListener("click", showForgotPasswordForm);
    byId("cancel-forgot-password").addEventListener("click", () => {
      byId("forgot-password-form").hidden = true;
      byId("login-form").hidden = false;
      byId("show-forgot-password").hidden = false;
      clearNotice();
    });

    byId("forgot-password-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (state.busy) return;
      setBusy(true);
      clearNotice();
      try {
        const { error } = await state.client.auth.resetPasswordForEmail(
          byId("recovery-email").value.trim(),
          { redirectTo: recoveryRedirectUrl() }
        );
        if (error) throw error;
        showNotice("Si el correo corresponde a una cuenta, recibirás un enlace para cambiar la contraseña. Revisá también el correo no deseado.");
      } catch (error) {
        showNotice(humanError(error), true);
      } finally {
        setBusy(false);
      }
    });

    byId("recovery-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (state.busy) return;
      clearNotice();
      if (!event.currentTarget.reportValidity()) return;
      const password = byId("new-password").value;
      if (password !== byId("confirm-password").value) {
        showNotice("Las contraseñas no coinciden.", true);
        byId("confirm-password").focus();
        return;
      }

      setBusy(true);
      try {
        const { error } = await state.client.auth.updateUser({ password });
        if (error) throw error;
        const { error: signOutError } = await state.client.auth.signOut();
        if (signOutError) throw signOutError;
        showLoggedOut();
        byId("login-email").value = byId("recovery-email").value.trim();
        history.replaceState(null, document.title, recoveryRedirectUrl());
        showNotice("Contraseña actualizada. Ya podés ingresar con tu nueva contraseña.");
      } catch (error) {
        showNotice(humanError(error), true);
      } finally {
        setBusy(false);
      }
    });

    byId("visit-form").addEventListener("submit", saveVisit);
    byId("payments-form").addEventListener("submit", processPayments);
    byId("sign-out").addEventListener("click", async () => {
      setBusy(true);
      try {
        const { error } = await state.client.auth.signOut();
        if (error) throw error;
        showLoggedOut();
        clearNotice();
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
          if (button.dataset.view === "form-view" && !state.editingId) {
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
  }

  async function start() {
    bindEvents();
    const configured = config?.supabaseUrl && config?.supabaseAnonKey
      && !config.supabaseUrl.includes("YOUR-PROJECT")
      && !config.supabaseAnonKey.includes("YOUR-ANON-KEY");
    if (!configured || !window.supabase?.createClient) {
      byId("setup-panel").hidden = false;
      return;
    }

    state.client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
    const recoveryLink = new URLSearchParams(window.location.hash.slice(1)).get("type") === "recovery";
    if (recoveryLink) showRecoveryPanel();
    else byId("login-panel").hidden = false;

    state.client.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") showRecoveryPanel();
      if (event === "SIGNED_OUT") showLoggedOut();
    });

    const { data, error } = await state.client.auth.getSession();
    if (error) {
      showNotice(humanError(error), true);
      return;
    }
    if (recoveryLink) {
      if (!data.session) {
        showNotice("El enlace de recuperación venció o ya fue utilizado. Solicitá uno nuevo e intentá nuevamente.", true);
        byId("recovery-panel").hidden = true;
        byId("login-panel").hidden = false;
      }
      return;
    }
    if (data.session?.user) {
      byId("login-panel").hidden = true;
      try {
        await openApplication(data.session.user);
      } catch (loadError) {
        await state.client.auth.signOut();
        showLoggedOut();
        showNotice(humanError(loadError), true);
      }
    }
  }

  start().catch((error) => {
    byId("setup-panel").hidden = false;
    showNotice(humanError(error), true);
  });
})();
