import { PATTERNS } from '../content/patterns.js';

const PATTERN_IDS   = Object.keys(PATTERNS);
const SEQUENCE_TYPES = ['pattern', 'text', 'solid', 'custom_grid'];
const TRANSITIONS    = ['cut', 'fade', 'wave'];

/**
 * Content editor overlay — manages the playlist visually.
 * Drag-to-reorder, add/edit/delete, live preview, save/export/import.
 */
export class ContentEditor {
  constructor(overlayEl, contentEngine) {
    this._overlay = overlayEl;
    this._engine  = contentEngine;
    this._playlist = null;
    this._dragSrc  = null;
  }

  init() {
    this._playlist = this._engine.getPlaylist();
    this._buildUI();
  }

  // ── Build overlay UI ──────────────────────────────────────────────────────

  _buildUI() {
    this._overlay.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;
                  padding:14px 20px;border-bottom:1px solid var(--border);flex-shrink:0">
        <span style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-dim)">
          Content Editor
        </span>
        <div style="display:flex;gap:8px;align-items:center">
          <button class="btn" id="ed-import">Import</button>
          <button class="btn" id="ed-export">Export</button>
          <button class="btn primary" id="ed-save">Save</button>
          <button class="btn" id="ed-close" style="color:var(--text-dim)">✕ Close</button>
        </div>
      </div>

      <div style="display:flex;flex:1;overflow:hidden">
        <!-- Sequence list -->
        <div style="width:260px;border-right:1px solid var(--border);display:flex;flex-direction:column">
          <div style="padding:10px 16px;border-bottom:1px solid var(--border);flex-shrink:0">
            <button class="btn primary" id="ed-add" style="width:100%">+ Add Sequence</button>
          </div>
          <div id="seq-list" style="flex:1;overflow-y:auto;padding:8px"></div>
        </div>

        <!-- Edit form -->
        <div id="ed-form" style="flex:1;padding:20px;overflow-y:auto"></div>
      </div>

      <input type="file" id="ed-file-input" accept=".json" style="display:none">
    `;

    this._renderList();
    this._bindActions();
  }

  // ── Sequence list ─────────────────────────────────────────────────────────

  _renderList() {
    const list = document.getElementById('seq-list');
    if (!list) return;
    list.innerHTML = '';

    this._playlist.sequences.forEach((seq, i) => {
      const item = document.createElement('div');
      item.className = 'seq-item';
      item.dataset.index = i;
      item.draggable = true;
      item.style.cssText = `
        padding:8px 10px;margin-bottom:4px;border-radius:3px;cursor:pointer;
        border:1px solid var(--border);background:var(--surface2);
        display:flex;align-items:center;gap:8px;user-select:none;
        font-size:11px;color:var(--text);
      `;

      const typeTag = document.createElement('span');
      typeTag.textContent = seq.type.substring(0, 4).toUpperCase();
      typeTag.style.cssText = `
        font-size:9px;color:var(--text-dim);background:var(--surface);
        border:1px solid var(--border);border-radius:2px;padding:1px 4px;flex-shrink:0;
      `;

      const label = document.createElement('span');
      label.style.flex = '1';
      label.textContent = seq.type === 'text'
        ? `"${seq.content}"`
        : seq.patternId ?? seq.id ?? `seq-${i}`;

      const del = document.createElement('button');
      del.textContent = '✕';
      del.style.cssText = `
        background:none;border:none;color:var(--text-dim);cursor:pointer;
        font-size:10px;padding:0 2px;flex-shrink:0;
      `;
      del.title = 'Delete';
      del.addEventListener('click', e => {
        e.stopPropagation();
        this._deleteSequence(i);
      });

      item.appendChild(typeTag);
      item.appendChild(label);
      item.appendChild(del);
      list.appendChild(item);

      // Click → edit + preview
      item.addEventListener('click', () => {
        list.querySelectorAll('.seq-item').forEach(el => el.style.borderColor = 'var(--border)');
        item.style.borderColor = 'var(--accent)';
        this._showForm(i);
        this._engine.previewSequence(seq);
      });

      // Drag-to-reorder
      item.addEventListener('dragstart', e => {
        this._dragSrc = i;
        e.dataTransfer.effectAllowed = 'move';
        item.style.opacity = '0.4';
      });
      item.addEventListener('dragend', () => { item.style.opacity = '1'; });
      item.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
      item.addEventListener('drop', e => {
        e.preventDefault();
        if (this._dragSrc !== null && this._dragSrc !== i) {
          const seqs = this._playlist.sequences;
          const [moved] = seqs.splice(this._dragSrc, 1);
          seqs.splice(i, 0, moved);
          this._dragSrc = null;
          this._renderList();
        }
      });
    });
  }

  // ── Edit form ─────────────────────────────────────────────────────────────

  _showForm(index) {
    const seq  = this._playlist.sequences[index];
    const form = document.getElementById('ed-form');
    if (!form) return;

    const field = (label, inputHtml) => `
      <div style="margin-bottom:14px">
        <label style="display:block;font-size:10px;color:var(--text-dim);
                      margin-bottom:5px;text-transform:uppercase;letter-spacing:0.08em">
          ${label}
        </label>
        ${inputHtml}
      </div>
    `;

    const inputStyle = `style="width:100%;background:var(--surface2);border:1px solid var(--border);
      color:var(--text);font-family:inherit;font-size:11px;padding:6px 8px;border-radius:3px;outline:none"`;

    const selectOpts = (opts, val) =>
      opts.map(o => `<option value="${o}" ${o===val?'selected':''}>${o}</option>`).join('');

    let typeFields = '';
    if (seq.type === 'pattern') {
      typeFields = field('Pattern', `
        <select id="f-patternId" ${inputStyle}>
          ${selectOpts(PATTERN_IDS, seq.patternId)}
        </select>
      `) + field('Speed', `<input id="f-speed" type="number" step="0.1" min="0.1" max="5"
        value="${seq.speed ?? 1}" ${inputStyle}>`);
    } else if (seq.type === 'text') {
      typeFields = field('Content', `<input id="f-content" type="text"
        value="${seq.content ?? ''}" maxlength="20" ${inputStyle}>`) +
        field('Brightness (0–255)', `<input id="f-brightness" type="number"
          min="0" max="255" value="${seq.brightness ?? 255}" ${inputStyle}>`) +
        field('Scroll', `<select id="f-scroll" ${inputStyle}>
          <option value="true" ${seq.scroll?'selected':''}>Yes</option>
          <option value="false" ${!seq.scroll?'selected':''}>No</option>
        </select>`);
    } else if (seq.type === 'solid') {
      typeFields = field('Value (0–255)', `<input id="f-value" type="number"
        min="0" max="255" value="${seq.value ?? 128}" ${inputStyle}>`);
    }

    form.innerHTML = `
      <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;
                  letter-spacing:0.1em;margin-bottom:16px">
        Edit sequence
      </div>
      ${field('ID', `<input id="f-id" type="text" value="${seq.id ?? ''}" ${inputStyle}>`)}
      ${field('Type', `<select id="f-type" ${inputStyle}>${selectOpts(SEQUENCE_TYPES, seq.type)}</select>`)}
      ${field('Duration (ms)', `<input id="f-duration" type="number" min="500" step="500"
        value="${seq.duration ?? 5000}" ${inputStyle}>`)}
      ${field('Transition', `<select id="f-transition" ${inputStyle}>
        ${selectOpts(TRANSITIONS, seq.transition ?? 'cut')}
      </select>`)}
      ${typeFields}
      <div style="display:flex;gap:8px;margin-top:20px">
        <button class="btn primary" id="f-apply" style="flex:1">Apply</button>
        <button class="btn" id="f-preview">Preview</button>
      </div>
    `;

    document.getElementById('f-type')?.addEventListener('change', () => {
      // Rerender form when type changes
      const newType = document.getElementById('f-type').value;
      this._playlist.sequences[index] = { ...seq, type: newType };
      this._showForm(index);
    });

    document.getElementById('f-apply')?.addEventListener('click', () => {
      this._applyForm(index);
    });

    document.getElementById('f-preview')?.addEventListener('click', () => {
      this._applyForm(index);
      this._engine.previewSequence(this._playlist.sequences[index]);
    });
  }

  _applyForm(index) {
    const seq = this._playlist.sequences[index];
    const g = id => document.getElementById(id)?.value;

    seq.id         = g('f-id') || seq.id;
    seq.duration   = parseInt(g('f-duration') || 5000, 10);
    seq.transition = g('f-transition') || 'cut';

    if (seq.type === 'pattern') {
      seq.patternId = g('f-patternId');
      seq.speed     = parseFloat(g('f-speed') || 1);
    } else if (seq.type === 'text') {
      seq.content    = g('f-content') || 'HELLO';
      seq.brightness = parseInt(g('f-brightness') || 255, 10);
      seq.scroll     = g('f-scroll') === 'true';
    } else if (seq.type === 'solid') {
      seq.value = parseInt(g('f-value') || 128, 10);
    }

    this._renderList();
  }

  // ── Add / delete ──────────────────────────────────────────────────────────

  _addSequence() {
    const seq = {
      id: `seq-${Date.now()}`,
      type: 'pattern',
      patternId: PATTERN_IDS[0],
      duration: 5000,
      speed: 1.0,
      transition: 'fade',
    };
    this._playlist.sequences.push(seq);
    this._renderList();
    this._showForm(this._playlist.sequences.length - 1);
  }

  _deleteSequence(index) {
    this._playlist.sequences.splice(index, 1);
    this._renderList();
    const form = document.getElementById('ed-form');
    if (form) form.innerHTML = '';
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  _bindActions() {
    document.getElementById('ed-close')?.addEventListener('click', () => {
      this._overlay.classList.remove('open');
    });

    document.getElementById('ed-add')?.addEventListener('click', () => {
      this._addSequence();
    });

    document.getElementById('ed-save')?.addEventListener('click', async () => {
      this._engine.setPlaylist(this._playlist);
      await this._engine.savePlaylist();
      const btn = document.getElementById('ed-save');
      if (btn) { btn.textContent = 'Saved ✓'; setTimeout(() => { btn.textContent = 'Save'; }, 1500); }
    });

    document.getElementById('ed-export')?.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(this._playlist, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'playlist.json';
      a.click();
    });

    document.getElementById('ed-import')?.addEventListener('click', () => {
      document.getElementById('ed-file-input')?.click();
    });

    document.getElementById('ed-file-input')?.addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        try {
          this._playlist = JSON.parse(ev.target.result);
          this._engine.setPlaylist(this._playlist);
          this._renderList();
        } catch (_) { alert('Invalid playlist JSON'); }
      };
      reader.readAsText(file);
    });
  }
}
