// Review notes are local to this browser. Export includes source snapshots as
// well as physical file line numbers so feedback survives later script edits.
function createStoryReviewNotes() {
    const storageKey = "arknights.translationReviews.v1";
    const readNotes = () => {
        const saved = JSON.parse(localStorage.getItem(storageKey) || "[]");
        if (!Array.isArray(saved) || saved.some((note) =>
            !note || typeof note.id !== "string" || !note.story ||
            !Array.isArray(note.lines) || typeof note.spanish !== "string" ||
            typeof note.comment !== "string" || typeof note.proposal !== "string")) {
            throw new Error("No se pudieron leer las notas guardadas.");
        }
        return saved;
    };
    let notes = [];
    const iconButton = (icon, label, className) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `${className} interactable`;
        button.title = label;
        button.setAttribute("aria-label", label);
        const image = document.createElement("i");
        image.className = `fas ${icon}`;
        image.setAttribute("aria-hidden", "true");
        button.append(image);
        return button;
    };
    const copy = iconButton("fa-clipboard", "Copiar revisión", "review-copy");
    const clear = iconButton("fa-eraser", "Borrar todas las notas", "review-clear");
    const count = document.createElement("span");
    count.className = "review-count";
    count.setAttribute("aria-hidden", "true");
    copy.append(count);
    const message = document.createElement("span");
    message.className = "review-copy-status";
    message.setAttribute("role", "status");
    document.getElementById("ccselector").append(copy, clear, message);

    const editor = document.createElement("dialog");
    editor.className = "review-dialog interactable";
    editor.setAttribute("aria-labelledby", "review-heading");
    editor.innerHTML = `
        <form class="review-form">
            <h2 id="review-heading">Revisar traducción</h2>
            <p class="review-location"></p>
            <blockquote class="review-quote"></blockquote>
            <label for="review-comment">Comentario</label>
            <textarea id="review-comment" rows="3" placeholder="¿Qué habría que cambiar?"></textarea>
            <label for="review-proposal">Traducción propuesta (opcional)</label>
            <textarea id="review-proposal" rows="3"></textarea>
            <p class="review-help">Las notas se guardan en este navegador. Usa el icono del portapapeles para copiar la revisión.</p>
            <p class="review-error" role="status"></p>
            <div class="review-actions">
                <button type="button" class="review-delete">Eliminar nota</button>
                <button type="button" class="review-cancel">Cancelar</button>
                <button type="submit" class="review-save">Guardar</button>
            </div>
        </form>`;
    document.body.append(editor);
    const form = editor.querySelector("form");
    const comment = editor.querySelector("#review-comment");
    const proposal = editor.querySelector("#review-proposal");
    const error = editor.querySelector(".review-error");
    const save = editor.querySelector(".review-save");
    const remove = editor.querySelector(".review-delete");
    let editing = null;

    const sceneLabel = (story) => {
        const scene = story.key.endsWith("_beg") ? "Antes del combate"
            : story.key.endsWith("_end") ? "Después del combate" : "";
        return [story.code || story.name, scene].filter(Boolean).join(" · ");
    };
    const markButton = (button) => {
        const saved = notes.some((note) => note.id === button.dataset.reviewId);
        button.classList.toggle("has-note", saved);
        button.parentElement.classList.toggle("has-review-note", saved);
        button.title = saved ? "Editar nota de revisión" : "Añadir nota de revisión";
        button.setAttribute("aria-label", button.title);
    };
    const refresh = () => {
        try {
            notes = readNotes();
            count.textContent = notes.length;
            copy.disabled = notes.length === 0;
            clear.disabled = notes.length === 0;
            copy.title = notes.length ? `Copiar revisión (${notes.length})` : "No hay notas de revisión";
            copy.setAttribute("aria-label", copy.title);
            clear.title = notes.length ? `Borrar todas las notas (${notes.length})` : "No hay notas que borrar";
            clear.setAttribute("aria-label", clear.title);
            document.querySelectorAll(".review-note-button").forEach(markButton);
        } catch {
            // Leave stored data untouched if storage is unavailable or malformed.
            message.textContent = "No se pudieron leer las notas de este navegador.";
            copy.disabled = true;
            clear.disabled = true;
        }
    };
    const persist = (id, note) => {
        const next = readNotes().filter((entry) => entry.id !== id);
        if (note) next.push(note);
        localStorage.setItem(storageKey, JSON.stringify(next));
        refresh();
    };
    clear.onclick = () => {
        try {
            localStorage.removeItem(storageKey);
            refresh();
            message.textContent = "Se borraron todas las notas de revisión.";
        } catch {
            message.textContent = "No se pudieron borrar las notas en este navegador.";
        }
    };
    editor.querySelector(".review-cancel").onclick = () => editor.close();
    editor.addEventListener("close", () => { editing = null; });
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!editing || save.disabled) return;
        const commentText = comment.value.trim();
        const proposalText = proposal.value.trim();
        if (!commentText && !proposalText) {
            error.textContent = "Escribe un comentario o una traducción propuesta.";
            comment.focus();
            return;
        }
        const current = editing;
        save.disabled = true;
        error.textContent = "";
        try {
            const original = await current.original;
            if (editing !== current || !editor.open) return;
            const { getEnglish, original: unused, ...snapshot } = current;
            persist(current.id, {
                ...snapshot,
                english: original.text,
                sourceError: original.error,
                comment: commentText,
                proposal: proposalText,
            });
            editor.close();
            message.textContent = original.error
                ? "Nota guardada. El original en inglés no estuvo disponible."
                : "Nota guardada.";
        } catch {
            error.textContent = "No se pudo guardar la nota en este navegador. Tu texto sigue aquí para que puedas copiarlo.";
        } finally {
            save.disabled = false;
        }
    });
    remove.onclick = () => {
        if (!editing) return;
        try {
            persist(editing.id, null);
            editor.close();
            message.textContent = "Nota eliminada.";
        } catch {
            error.textContent = "No se pudo eliminar la nota en este navegador.";
        }
    };

    const quote = (text) => String(text).split(/\r?\n/).map((line) => `> ${line}`).join("\n");
    const exportNotes = (entries) => "# Revisión de traducción\n\n" + entries
        .slice().sort((a, b) => a.story.key.localeCompare(b.story.key) || a.lines[0] - b.lines[0])
        .map((note) => [
            `## ${sceneLabel(note.story)} · ${note.speaker}`,
            `Archivo: gamedata/es_ES/story/${note.story.key}.txt`,
            `Líneas: ${note.lines.join(", ")} · Campo: ${note.field}`,
            `Fuente: ${note.sourceUrl}`,
            "### Inglés\n" + quote(note.english ?? `Original no disponible: ${note.sourceError}`),
            "### Español\n" + quote(note.spanish),
            ...(note.comment ? ["### Comentario\n" + quote(note.comment)] : []),
            ...(note.proposal ? ["### Propuesta\n" + quote(note.proposal)] : []),
        ].join("\n\n")).join("\n\n") + "\n";
    const fallback = document.createElement("dialog");
    fallback.className = "review-dialog interactable";
    fallback.setAttribute("aria-labelledby", "review-export-heading");
    fallback.innerHTML = `
        <h2 id="review-export-heading">Copiar revisión</h2>
        <p>No se pudo copiar automáticamente. Copia el texto seleccionado y pégalo en la conversación.</p>
        <textarea class="review-export-text" aria-label="Revisión completa" rows="12" readonly></textarea>
        <button type="button">Cerrar</button>`;
    fallback.querySelector("button").onclick = () => fallback.close();
    document.body.append(fallback);
    copy.onclick = async () => {
        let text;
        try {
            const entries = readNotes();
            if (!entries.length) return;
            text = exportNotes(entries);
        } catch {
            message.textContent = "No se pudieron leer las notas guardadas.";
            return;
        }
        try {
            await navigator.clipboard.writeText(text);
            message.textContent = "Revisión copiada. Puedes pegarla en la conversación.";
        } catch {
            const textarea = fallback.querySelector("textarea");
            textarea.value = text;
            fallback.showModal();
            textarea.focus();
            textarea.select();
        }
    };
    window.addEventListener("storage", (event) => {
        if (event.key === storageKey || event.key === null) refresh();
    });
    refresh();
    return {
        attach(box, context) {
            const id = JSON.stringify([context.story.key, context.field, context.lines]);
            const button = iconButton("fa-comment-alt", "Añadir nota de revisión", "review-note-button");
            button.dataset.reviewId = id;
            box.append(button);
            box.classList.add("has-review-control");
            markButton(button);
            button.onclick = (event) => {
                event.stopPropagation();
                refresh();
                const existing = notes.find((note) => note.id === id);
                editing = {
                    ...context, id,
                    original: context.getEnglish().then(
                        (text) => ({ text, error: null }),
                        () => ({ text: null, error: "No se pudo obtener un original compatible con esta traducción." }),
                    ),
                };
                editor.querySelector(".review-location").textContent =
                    `${sceneLabel(context.story)} · ${context.speaker} · Línea ${context.lines.join(", ")}`;
                editor.querySelector(".review-quote").textContent = context.spanish;
                comment.value = existing?.comment || "";
                proposal.value = existing?.proposal || "";
                error.textContent = "";
                save.disabled = false;
                remove.hidden = !existing;
                editor.showModal();
                comment.focus();
            };
        },
    };
}
