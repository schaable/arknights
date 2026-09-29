// Match the same script lines used by the reader, never translated text values.
function createEnglishComparison(source, url, { prefix = "", renderText, onLayout, review, story }) {
    const parseLines = (text) => Array.from(text.matchAll(/^(\[[^\]]+])?(.*)?$/gim));
    const sourceLines = parseLines(source);
    const signature = (line) => {
        const tag = line[1] || "";
        const command = /^\[\s*([\w]+)/.exec(tag)?.[1].toLowerCase();
        const allowed = {
            name: ["name", "name2"], name2: ["name", "name2"],
            character: ["name", "name2"],
            subtitle: ["text"], sticker: ["text"], decision: ["options"],
            multiline: ["name"],
        }[command] || [];
        return tag.replace(/(name2?|text|options)\s*=\s*"([^"]*)"/gi, (match, attr, value) => {
            if (!allowed.includes(attr.toLowerCase())) return match;
            if (/^name2?$/i.test(attr) &&
                (/^(char_|avg_|npc_)/i.test(value) || /[$#]/.test(value))) return match;
            return `${attr}="<TEXT>"`;
        }) + (line[2]?.trim() ? "<TEXT>" : "");
    };
    let pending;
    const load = () => {
        if (!pending) {
            pending = fetch(url).then(async (response) => {
                if (!response.ok) throw new Error("No se pudo cargar el inglés. Intenta de nuevo.");
                const english = parseLines(prefix + await response.text());
                if (english.length !== sourceLines.length ||
                    english.some((line, i) => signature(line) !== signature(sourceLines[i]))) {
                    throw new Error("El original cambió y no se puede asociar con esta traducción.");
                }
                return english;
            }).catch((error) => {
                pending = null; // A failed request can be retried without reloading the story.
                throw error;
            });
        }
        return pending;
    };
    return {
        attach(box, { indexes, field = "free" }) {
            const readText = (lines) => indexes.map((i) => {
                if (field === "free") return lines[i][2] || "";
                return new RegExp(`${field}\\s*=\\s*"([^"]*)"`, "i")
                    .exec(lines[i][1])?.[1] || "";
            }).join("");
            const targets = field === "options"
                ? Array.from(box.querySelectorAll(":scope > .decision"))
                : [box.querySelector(":scope > .interactable-text:not(.dialog-name)")];
            const spanish = targets.map((target) => target.innerHTML);
            targets.forEach((target) => { target.lang = "es"; });
            const button = document.createElement("button");
            button.type = "button";
            button.className = "english-toggle interactable";
            button.title = "Ver inglés";
            button.setAttribute("aria-label", "Alternar español e inglés");
            button.setAttribute("aria-pressed", "false");
            const icon = document.createElement("i");
            icon.className = "fas fa-language";
            icon.setAttribute("aria-hidden", "true");
            button.append(icon);
            const status = document.createElement("span");
            status.className = "english-status";
            status.setAttribute("role", "status");
            status.hidden = true;
            box.append(button, status);
            box.classList.add("has-english");
            review?.attach(box, {
                story,
                field,
                lines: indexes.map((i) => source.slice(prefix.length, sourceLines[i].index).split("\n").length),
                speaker: box.classList.contains("doctor") ? "Doctor"
                    : box.querySelector(".dialog-name")?.textContent.trim() || "Narración",
                spanish: readText(sourceLines),
                sourceUrl: url,
                getEnglish: async () => readText(await load()),
            });
            let english;
            let wantsEnglish = false;
            let loading = false;
            const display = (inEnglish) => {
                targets.forEach((target, i) => {
                    renderText(target, (inEnglish ? english : spanish)[i]);
                    target.lang = inEnglish ? "en" : "es";
                });
                button.setAttribute("aria-pressed", String(inEnglish));
                button.title = inEnglish ? "Ver español" : "Ver inglés";
                if (box.isConnected) onLayout();
            };
            const toggle = async () => {
                wantsEnglish = !wantsEnglish;
                status.hidden = true;
                if (!wantsEnglish) {
                    display(false);
                    return;
                }
                if (english) {
                    display(true);
                    return;
                }
                if (loading) return;
                loading = true;
                button.setAttribute("aria-busy", "true");
                button.title = "Cargando inglés...";
                try {
                    const lines = await load();
                    const text = readText(lines);
                    const values = field === "options" ? text.split(";") : [text];
                    if (values.length !== targets.length) {
                        throw new Error("El original cambió y no se puede asociar con esta traducción.");
                    }
                    english = values;
                    if (wantsEnglish) display(true);
                } catch (error) {
                    if (wantsEnglish) {
                        wantsEnglish = false;
                        status.textContent = error instanceof TypeError
                            ? "No se pudo cargar el inglés. Intenta de nuevo." : error.message;
                        status.hidden = false;
                    }
                } finally {
                    loading = false;
                    button.removeAttribute("aria-busy");
                    button.title = button.getAttribute("aria-pressed") === "true"
                        ? "Ver español" : "Ver inglés";
                    if (box.isConnected) onLayout();
                }
            };
            // Ignore drags and long presses, including the reader's background gesture.
            let press;
            box.addEventListener("pointerdown", (event) => {
                press = { x: event.clientX, y: event.clientY, time: performance.now(), moved: false };
            });
            box.addEventListener("pointermove", (event) => {
                if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 6)
                    press.moved = true;
            });
            box.addEventListener("pointercancel", () => { if (press) press.moved = true; });
            button.addEventListener("click", (event) => {
                event.stopPropagation();
                toggle();
            });
            box.addEventListener("click", (event) => {
                if (event.target.closest("button, a, input, select, textarea, .decision, [contenteditable]")) return;
                if (window.getSelection()?.toString()) return;
                if (press && (press.moved || performance.now() - press.time >= 250)) return;
                toggle();
            });
        },
    };
}
