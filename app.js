(() => {
  "use strict";

  const config = window.EOD_CONFIG;
  const byId = (id) => document.getElementById(id);
  const state = {
    client: null,
    user: null,
    profile: null,
    visits: [],
    properties: [],
    profiles: [],
    audit: [],
    editingId: null,
    recoveryMode: false,
    busy: false
  };

  function showNotice(message, isError = false) {
    const notice = byId("notice");
    notice.textContent = message;
    notice.classList.toggle("error", isError);
    notice.hidden = false;
  }

  function clearNotice() {
    byId("notice").hidden = true;
    byId("notice").textContent = "";
    byId("notice").classList.remove("error");
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

  function formatDate(value) {
    if (!value) return "Sin fecha";
    const [year, month, day] = value.slice(0, 10).split("-");
    return `${day}/${month}/${year.slice(-2)}`;
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

  function propertyFor(number) {
    return state.properties.find((property) => property.property_number === number);
  }

  function isAdmin() {
    return state.profile?.role === "admin";
  }

  function setView(viewId) {
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
    state.visits = [];
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

  async function loadData() {
    const [visitsResult, propertiesResult, profilesResult] = await Promise.all([
      state.client.from("visits").select("*").order("visit_date", { ascending: false }),
      state.client.from("properties").select("*"),
      state.client.from("profiles").select("id,email,display_name,role")
    ]);

    const failure = [visitsResult, propertiesResult, profilesResult].find((result) => result.error);
    if (failure) throw failure.error;

    state.visits = visitsResult.data || [];
    state.properties = propertiesResult.data || [];
    state.profiles = profilesResult.data || [];

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
    const query = normalize(byId("search-query").value.trim());
    const queryDigits = query.replace(/\D/g, "");
    const from = byId("filter-from").value;
    const to = byId("filter-to").value;
    const userId = byId("filter-user").value;
    const status = activeOnly ? "active" : byId("filter-status").value;

    return state.visits.filter((visit) => {
      const property = propertyFor(visit.property_number);
      const parentArchived = Boolean(property?.archived_at);
      const isArchived = Boolean(visit.archived_at || parentArchived);
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
    byId("result-count").textContent = `${results.length} ${results.length === 1 ? "visita" : "visitas"}`;

    if (!results.length) {
      container.innerHTML = '<div class="empty-state">No se encontraron visitas con esos criterios.</div>';
      return;
    }

    container.innerHTML = results.map((visit) => {
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
      const editButton = !archived
        ? `<button class="button button-small button-quiet" type="button" data-action="edit" data-id="${escapeHtml(visit.id)}">Editar</button>`
        : "";

      return `
        <article class="result-card">
          <div class="result-top">
            <h3>Predio ${escapeHtml(visit.property_number)} · ${escapeHtml(formatDate(visit.visit_date))}</h3>
            <span class="state-label${archived ? " archived" : ""}">${archived ? "Archivado" : "Activo"}</span>
          </div>
          <p><strong>Contacto:</strong> ${escapeHtml(visit.contact_name)}</p>
          <p><strong>Celular:</strong> ${escapeHtml(visit.cellphone)}</p>
          ${visit.notes ? `<p class="result-notes"><strong>Notas:</strong> ${escapeHtml(visit.notes)}</p>` : ""}
          <p class="result-meta">Registró ${escapeHtml(profileName(visit.created_by))} · Última edición ${escapeHtml(profileName(visit.updated_by))}</p>
          <div class="result-actions">${editButton}${visitButton}${propertyButton}</div>
        </article>`;
    }).join("");
  }

  function changedFields(entry) {
    if (entry.action === "INSERT") return "Registro creado.";
    if (entry.action === "DELETE") return "Registro eliminado.";
    const oldData = entry.old_data || {};
    const newData = entry.new_data || {};
    const ignored = new Set(["updated_by", "updated_at"]);
    const keys = [...new Set([...Object.keys(oldData), ...Object.keys(newData)])]
      .filter((key) => !ignored.has(key) && JSON.stringify(oldData[key]) !== JSON.stringify(newData[key]));
    if (!keys.length) return "Se actualizó el registro.";
    return keys.map((key) => {
      const oldValue = oldData[key] ?? "—";
      const newValue = newData[key] ?? "—";
      return `${key}: ${oldValue} → ${newValue}`;
    }).join(" · ");
  }

  function renderActivity() {
    const container = byId("activity-list");
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
          <span class="state-label">${escapeHtml(entry.action)}</span>
          <span class="result-meta">${escapeHtml(formatDateTime(entry.changed_at))}</span>
        </div>
        <p>${escapeHtml(entry.entity_type === "property" ? "Predio" : "Visita")} · ${escapeHtml(entry.entity_id)}</p>
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
    byId("welcome-title").textContent = `Hola, ${profileName(data.id)}`;
    byId("role-badge").textContent = data.role === "admin" ? "Administrador" : "Técnico";
    byId("activity-tab").hidden = !isAdmin();
    byId("export-actions").hidden = !isAdmin();
    byId("filter-status").value = "active";
    byId("visit-date").value = localDateInputValue();
    setView(isAdmin() ? "activity-view" : "form-view");
    await loadData();
  }

  function resetVisitForm() {
    byId("visit-form").reset();
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
        showNotice("Los cambios de la visita se guardaron correctamente.");
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
        showNotice("La visita se registró correctamente.");
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
    const headings = ["Predio", "Fecha", "Nombre de contacto", "Celular", "Notas", "Estado", "Creado por", "Creado", "Última edición por", "Última edición"];
    const rows = visits.map((visit) => {
      const archived = Boolean(visit.archived_at || propertyFor(visit.property_number)?.archived_at);
      return [
        visit.property_number,
        formatDate(visit.visit_date),
        visit.contact_name,
        visit.cellphone,
        visit.notes || "",
        archived ? "Archivado" : "Activo",
        profileName(visit.created_by),
        formatDateTime(visit.created_at),
        profileName(visit.updated_by),
        formatDateTime(visit.updated_at)
      ];
    });
    const csv = "\uFEFF" + [headings, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
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
      button.addEventListener("click", () => {
        clearNotice();
        setView(button.dataset.view);
      });
    });

    ["search-query", "filter-from", "filter-to", "filter-user", "filter-status"].forEach((id) => {
      byId(id).addEventListener(id === "search-query" ? "input" : "change", renderVisits);
    });

    byId("notes").addEventListener("input", (event) => {
      byId("notes-count").textContent = String(event.target.value.length);
    });
    byId("cancel-edit").addEventListener("click", resetVisitForm);
    byId("visit-results").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      if (button.dataset.action === "edit") beginEdit(button.dataset.id);
      else toggleArchive(button);
    });
    byId("export-filtered").addEventListener("click", () => exportCsv(filteredVisits(), "filtrados"));
    byId("export-all").addEventListener("click", () => exportCsv(filteredVisits(true), "todos-activos"));
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
