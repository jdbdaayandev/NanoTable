/**
 * NanoTable
 * A lightweight, dependency-free Datatable library for modern browsers.
 * Built for performance, server-side/client-side data, and minimal footprint.
 */

export default class NanoTable {
  constructor(container, options) {
    this.container = typeof container === 'string' ? document.querySelector(container) : container;
    
    let existingTable = this.container.tagName === 'TABLE' ? this.container : this.container.querySelector('table');
    let extractedColumns = [];
    let extractedData = [];
    
    if (existingTable) {
        const ths = existingTable.querySelectorAll('thead th');
        if (ths.length > 0) {
            extractedColumns = Array.from(ths).map((th, i) => ({
                key: th.dataset.key || `col_${i}`,
                title: this.escapeHTML(th.textContent.trim()),
                sortable: th.dataset.sortable !== 'false'
            }));
        }
        
        const trs = existingTable.querySelectorAll('tbody tr');
        if (trs.length > 0 && extractedColumns.length > 0) {
            extractedData = Array.from(trs).map(tr => {
                const rowData = {};
                const tds = tr.querySelectorAll('td');
                tds.forEach((td, i) => {
                    if (extractedColumns[i]) {
                        rowData[extractedColumns[i].key] = td.innerHTML;
                        rowData[`_${extractedColumns[i].key}_text`] = td.textContent.trim();
                    }
                });
                return rowData;
            });
        }
        
        if (this.container.tagName === 'TABLE') {
            const wrapper = document.createElement('div');
            this.container.parentNode.insertBefore(wrapper, this.container);
            this.container.remove();
            this.container = wrapper;
        } else {
            existingTable.remove();
        }
    }
    
    options = options || {};
    
    this.options = {
      data: options.data || extractedData,
      columns: options.columns || extractedColumns,
      pageSize: 10,
      serverSide: false,
      ajax: null,
      searchable: true,
      exportable: true,
      exportFilename: 'export.csv',
      selectable: false,
      responsive: true,
      loading: false,
      fontSize: '14px',
      theme: 'default',
      searchableColumns: [],
      ...options
    };
    
    const origCols = this.options.columns;
    this.searchableKeys = Array.isArray(this.options.searchableColumns) && this.options.searchableColumns.length > 0
       ? this.options.searchableColumns.map(idx => origCols[idx]?.key).filter(Boolean)
       : origCols.map(c => c.key);
    
    if (this.options.selectable) {
        this.options.columns.unshift({
            key: '_checkbox',
            title: '<input type="checkbox" class="nt-select-all" />',
            sortable: false,
            render: (val, row) => `<input type="checkbox" class="nt-select-row" />`
        });
    }

    if (this.options.responsive) {
        this.options.columns.unshift({
            key: '_expand',
            title: '',
            sortable: false,
            render: () => `<button class="nt-expand-btn"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg></button>`
        });
    }
    
    this.state = {
      page: 1,
      search: '',
      sortColumn: null,
      sortDesc: false,
      total: this.options.data.length,
      loading: this.options.loading,
      displayData: []
    };

    this.init();
  }

  escapeHTML(str) {
      if (str === null || str === undefined) return '';
      return String(str)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#039;");
  }

  init() {
    this.renderShell();
    this.cacheDOM();
    this.bindEvents();
    this.initResponsive();
    this.loadData();
  }

  renderShell() {
    if (!this.container) return;

    const themeClass = this.options.theme !== 'default' ? `nt-theme-${this.escapeHTML(this.options.theme)}` : '';

    this.container.innerHTML = `
      <div class="nt-wrapper ${themeClass}" style="--nt-font-size: ${this.escapeHTML(this.options.fontSize)};">
        <div class="nt-header">
          <div class="nt-actions">
            <div class="nt-length">
              <span class="nt-length-label">Show</span>
              <div class="nt-dropdown-wrap">
                <button class="nt-dropdown-btn nt-page-size-btn">
                  <span class="nt-page-size-text">${parseInt(this.options.pageSize, 10)}</span>
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </button>
                <div class="nt-dropdown-menu nt-page-size-menu">
                  ${[10, 25, 50, 100].map(size => `<div class="nt-dropdown-item nt-page-size-item" data-value="${size}">${size}</div>`).join('')}
                </div>
              </div>
              <span class="nt-length-label">entries</span>
            </div>
            ${this.options.exportable ? `
            <div class="nt-dropdown-wrap">
              <button class="nt-dropdown-btn nt-export-btn">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                Export
              </button>
              <div class="nt-dropdown-menu nt-export-menu">
                <div class="nt-dropdown-item nt-export-item" data-type="csv">CSV</div>
                <div class="nt-dropdown-item nt-export-item" data-type="excel">Excel</div>
                <div class="nt-dropdown-item nt-export-item" data-type="word">Word</div>
                <div class="nt-dropdown-item nt-export-item" data-type="pdf">PDF</div>
              </div>
            </div>` : ''}
          </div>
          ${this.options.searchable ? `
          <div class="nt-search-wrap">
            <svg class="nt-search-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <input type="search" class="nt-search" placeholder="Search..." />
          </div>` : '<div></div>'}
        </div>
        <div class="nt-table-container">
          <div class="nt-loader ${this.state.loading ? 'show' : ''}"><div class="nt-spinner"></div></div>
          <table class="nt-table">
            <thead>
              <tr>
                ${this.options.columns.map((col, i) => `
                  <th data-index="${i}" class="${col.sortable !== false ? 'nt-sortable' : ''}">
                    <div style="display: flex; align-items: center; justify-content: space-between;">
                       <div>${col.title} <span class="nt-sort-icon"></span></div>
                    </div>
                  </th>
                `).join('')}
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
        <div class="nt-footer">
          <div class="nt-info"></div>
          <div class="nt-pagination">
             <button class="nt-prev" disabled>Previous</button>
             <span class="nt-page-info"></span>
             <button class="nt-next" disabled>Next</button>
          </div>
        </div>
      </div>
    `;
    
    if (!document.getElementById('nt-styles')) {
      const style = document.createElement('style');
      style.id = 'nt-styles';
      style.innerHTML = `
        /* BASE STYLES */
        .nt-wrapper { font-family: ui-sans-serif, system-ui, sans-serif; color: #0f172a; font-size: var(--nt-font-size, 14px); background: #fff; padding: 1.5em; border-radius: 12px; box-sizing: border-box; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1); border: 1px solid #e2e8f0; }
        .nt-wrapper * { box-sizing: border-box; }
        .nt-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1em; flex-wrap: wrap; gap: 1em; }
        .nt-actions { display: flex; align-items: center; gap: 1em; flex-wrap: wrap; }
        .nt-length { display: flex; align-items: center; gap: 0.5em; }
        .nt-length-label { color: #64748b; font-weight: 500; font-size: 0.9em; }
        .nt-page-size { appearance: none; -webkit-appearance: none; border: 1px solid #cbd5e1; border-radius: 6px; padding: 0.4em 2em 0.4em 0.8em; outline: none; background: #fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E") no-repeat right 0.5em center; color: #0f172a; cursor: pointer; font-family: inherit; font-size: 0.9em; font-weight: 500; transition: border-color 0.2s, box-shadow 0.2s; box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05); }
        .nt-page-size:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1); }
        .nt-search-wrap { display: flex; align-items: center; position: relative; width: 260px; max-width: 100%; }
        .nt-search-icon { position: absolute; left: 0.8em; width: 1.2em; height: 1.2em; color: #94a3b8; }
        .nt-search { border: 1px solid #cbd5e1; border-radius: 6px; padding: 0.5em 0.8em 0.5em 2.4em; outline: none; background: #fff; color: #0f172a; font-family: inherit; font-size: 0.9em; transition: border-color 0.2s, box-shadow 0.2s; width: 100%; box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05); }
        .nt-search:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1); }
        .nt-search::placeholder { color: #94a3b8; }
        .nt-dropdown-wrap { position: relative; }
        .nt-dropdown-menu { position: absolute; top: 100%; right: 0; margin-top: 4px; background: #fff; border: 1px solid #cbd5e1; border-radius: 6px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); display: none; z-index: 10; min-width: 100px; overflow: hidden; }
        .nt-dropdown-menu.show { display: block; }
        .nt-dropdown-item { padding: 8px 16px; cursor: pointer; color: #0f172a; font-size: 13px; font-weight: 500; transition: background 0.15s; }
        .nt-dropdown-item:hover { background: #f1f5f9; }
        .nt-dropdown-btn { display: flex; align-items: center; justify-content: space-between; gap: 0.4em; background: #fff; border: 1px solid #cbd5e1; padding: 0.5em 1em; border-radius: 6px; cursor: pointer; color: #0f172a; font-weight: 600; font-size: 0.9em; transition: all 0.2s; box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05); }
        .nt-dropdown-btn:hover { background: #f8fafc; border-color: #94a3b8; }
        .nt-dropdown-btn svg { color: #64748b; }
        .nt-table-container { position: relative; overflow-x: auto; margin-bottom: 1em; border: 1px solid #e2e8f0; border-radius: 8px; }
        .nt-loader { position: absolute; inset: 0; background: rgba(255,255,255,0.7); display: flex; align-items: center; justify-content: center; z-index: 5; opacity: 0; pointer-events: none; transition: opacity 0.2s; }
        .nt-loader.show { opacity: 1; pointer-events: auto; }
        .nt-spinner { width: 32px; height: 32px; border: 3px solid #cbd5e1; border-top-color: #3b82f6; border-radius: 50%; animation: nt-spin 1s linear infinite; }
        @keyframes nt-spin { to { transform: rotate(360deg); } }
        .nt-table { width: 100%; border-collapse: collapse; clear: both; border-spacing: 0; }
        .nt-table th, .nt-table td { padding: 1em 1.5em; text-align: left; }
        .nt-table td { white-space: normal; word-break: break-word; line-height: 1.5; }
        .nt-table th { white-space: nowrap; }
        .nt-table th { border-bottom: 1px solid #e2e8f0; font-weight: 600; color: #475569; position: relative; background: #f8fafc; text-transform: uppercase; font-size: 0.85em; letter-spacing: 0.05em; overflow: visible; }
        .nt-table td { border-bottom: 1px solid #f1f5f9; color: #334155; }
        .nt-table tbody tr:last-child td { border-bottom: none; }
        .nt-table tbody tr { background-color: #fff; transition: background-color 0.15s; }
        .nt-table tbody tr:hover { background-color: #f8fafc; }
        .nt-sortable { cursor: pointer; padding-right: 2.5em !important; transition: background-color 0.2s; }
        .nt-sortable:hover { background: #f1f5f9; color: #0f172a; }
        .nt-sort-icon { position: absolute; right: 1em; top: 50%; transform: translateY(-50%); opacity: 0.3; font-size: 0.7em; }
        .nt-sortable:hover .nt-sort-icon { opacity: 0.8; }
        .nt-table th:first-child, .nt-table td:first-child { width: 40px; text-align: center; padding-left: 1em; padding-right: 0.5em; }
        .nt-select-all, .nt-select-row { cursor: pointer; width: 16px; height: 16px; accent-color: #3b82f6; }
        .nt-expand-btn { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; border: 1px solid #cbd5e1; background: #fff; cursor: pointer; color: #3b82f6; transition: all 0.2s; padding: 0; outline: none; }
        .nt-expand-btn:hover { background: #f8fafc; border-color: #94a3b8; }
        .nt-expand-btn svg { transition: transform 0.2s; }
        .nt-expand-btn.open svg { transform: rotate(45deg); }
        .nt-child-row { background-color: #f8fafc !important; }
        .nt-child-row td { padding: 1em 2em !important; border-bottom: 1px solid #e2e8f0; }
        .nt-child-details { display: flex; flex-direction: column; gap: 0.5em; }
        .nt-child-detail { display: flex; align-items: baseline; gap: 1em; }
        .nt-child-title { font-weight: 600; color: #475569; min-width: 120px; }
        .nt-child-value { color: #0f172a; word-break: break-word; }
        .nt-footer { display: flex; justify-content: space-between; align-items: center; padding-top: 0.5em; color: #64748b; flex-wrap: wrap; gap: 1em; }
        .nt-pagination { display: flex; align-items: center; gap: 0.25em; }
        .nt-pagination button { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; min-width: 2.2em; height: 2.2em; padding: 0 0.5em; font-weight: 500; font-size: 0.9em; text-align: center; text-decoration: none !important; cursor: pointer; color: #475569; border: 1px solid transparent; border-radius: 6px; background: transparent; transition: all 0.2s; }
        .nt-pagination button:hover:not(:disabled):not(.active) { background: #f1f5f9; color: #0f172a; }
        .nt-pagination button:disabled { color: #94a3b8; cursor: not-allowed; opacity: 0.5; }
        .nt-page-info { display: flex; gap: 0.25em; margin: 0 0.25em; }
        .nt-page-btn { padding: 0 0.5em; min-width: 2.2em; height: 2.2em; cursor: pointer; border: 1px solid transparent; background: transparent; border-radius: 6px; color: #475569; font-weight: 500; font-size: 0.9em; transition: all 0.2s; display: inline-flex; align-items: center; justify-content: center; }
        .nt-page-btn:hover:not(.active) { background: #f1f5f9; color: #0f172a; }
        .nt-page-btn.active { background: #3b82f6; color: #fff; font-weight: 600; box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05); }
        @media (max-width: 640px) {
          .nt-header { flex-direction: column; align-items: stretch; gap: 1em; }
          .nt-search-wrap { width: 100%; }
          .nt-actions { justify-content: space-between; width: 100%; }
          .nt-footer { flex-direction: column; align-items: center; gap: 1em; }
          .nt-page-info { display: none; }
        }

        /* =========================================
           🌙 Theme 1: Midnight Dark 
        ========================================= */
        .nt-wrapper.nt-theme-dark { background: #1e293b; color: #f8fafc; border-color: #334155; }
        .nt-theme-dark .nt-header { color: #cbd5e1; }
        .nt-theme-dark .nt-table th { background: #0f172a; color: #94a3b8; border-color: #334155; }
        .nt-theme-dark .nt-table td { color: #e2e8f0; border-color: #334155; }
        .nt-theme-dark .nt-table tbody tr { background: #1e293b; }
        .nt-theme-dark .nt-table tbody tr:hover { background: #334155; }
        .nt-theme-dark .nt-search, 
        .nt-theme-dark .nt-page-size,
        .nt-theme-dark .nt-dropdown-btn { background-color: #0f172a; color: #f8fafc; border-color: #475569; }
        .nt-theme-dark .nt-dropdown-menu { background: #1e293b; border-color: #475569; }
        .nt-theme-dark .nt-dropdown-item { color: #f8fafc; }
        .nt-theme-dark .nt-dropdown-item:hover { background: #334155; }
        .nt-theme-dark .nt-page-btn { color: #94a3b8; }
        .nt-theme-dark .nt-page-btn:hover:not(.active) { background: #334155; color: #f8fafc; }
        .nt-theme-dark .nt-child-row { background-color: #0f172a !important; }
        .nt-theme-dark .nt-child-value, .nt-theme-dark .nt-child-title { color: #f8fafc; }

        /* =========================================
           🏢 Theme 2: Corporate Indigo 
        ========================================= */
        .nt-wrapper.nt-theme-indigo { border-top: 4px solid #4f46e5; border-radius: 8px; }
        .nt-theme-indigo .nt-table th { background: #4f46e5; color: #ffffff; border-bottom: none; }
        .nt-theme-indigo .nt-sort-icon { color: #ffffff; opacity: 0.7; }
        .nt-theme-indigo .nt-table tbody tr:nth-child(even) { background-color: #f8fafc; }
        .nt-theme-indigo .nt-table tbody tr:hover { background-color: #e0e7ff; }
        .nt-theme-indigo .nt-page-btn.active { background: #4f46e5; box-shadow: 0 4px 6px -1px rgba(79, 70, 229, 0.3); }

        /* =========================================
           ☁️ Theme 3: Soft Material 
        ========================================= */
        .nt-wrapper.nt-theme-material { border: none; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1); border-radius: 16px; }
        .nt-theme-material .nt-search, 
        .nt-theme-material .nt-page-size,
        .nt-theme-material .nt-dropdown-btn { border-radius: 20px; background: #f1f5f9; border: 1px solid transparent; }
        .nt-theme-material .nt-search:focus { background: #ffffff; border-color: #0ea5e9; }
        .nt-theme-material .nt-table th { background: transparent; border-bottom: 2px solid #e2e8f0; text-transform: capitalize; font-size: 0.95em; }
        .nt-theme-material .nt-table td { border-bottom: 1px dashed #e2e8f0; }
        .nt-theme-material .nt-page-btn { border-radius: 50%; min-width: 2.5em; height: 2.5em; }
        .nt-theme-material .nt-page-btn.active { background: #0ea5e9; }
      `;
      document.head.appendChild(style);
    }
  }

  cacheDOM() {
    this.dom = {
      wrapper: this.container.querySelector('.nt-wrapper'),
      pageSizeBtn: this.container.querySelector('.nt-page-size-btn'),
      pageSizeMenu: this.container.querySelector('.nt-page-size-menu'),
      pageSizeItems: this.container.querySelectorAll('.nt-page-size-item'),
      pageSizeText: this.container.querySelector('.nt-page-size-text'),
      search: this.container.querySelector('.nt-search'),
      exportBtn: this.container.querySelector('.nt-export-btn'),
      exportMenu: this.container.querySelector('.nt-export-menu'),
      exportItems: this.container.querySelectorAll('.nt-export-item'),
      loader: this.container.querySelector('.nt-loader'),
      tbody: this.container.querySelector('tbody'),
      thead: this.container.querySelector('thead'),
      ths: this.container.querySelectorAll('th.nt-sortable'),
      info: this.container.querySelector('.nt-info'),
      prev: this.container.querySelector('.nt-prev'),
      next: this.container.querySelector('.nt-next'),
      pageInfo: this.container.querySelector('.nt-page-info')
    };
  }

  bindEvents() {
    if (this.dom.pageSizeBtn && this.dom.pageSizeMenu) {
      this.dom.pageSizeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.dom.pageSizeMenu.classList.toggle('show');
      });
      document.addEventListener('click', () => {
        this.dom.pageSizeMenu.classList.remove('show');
      });
      this.dom.pageSizeItems.forEach(item => {
        item.addEventListener('click', (e) => {
           this.options.pageSize = parseInt(e.currentTarget.dataset.value, 10);
           if (this.dom.pageSizeText) {
             this.dom.pageSizeText.textContent = this.options.pageSize;
           }
           this.state.page = 1;
           this.loadData();
        });
      });
    }

    if (this.dom.search) {
      let timeout;
      this.dom.search.addEventListener('input', (e) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
          this.state.search = e.target.value.trim();
          this.state.page = 1;
          this.loadData();
        }, 300);
      });
    }

    if (this.dom.exportBtn && this.dom.exportMenu) {
      this.dom.exportBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.dom.exportMenu.classList.toggle('show');
      });
      document.addEventListener('click', () => {
        this.dom.exportMenu.classList.remove('show');
      });
      this.dom.exportItems.forEach(item => {
        item.addEventListener('click', (e) => {
           const type = e.currentTarget.dataset.type;
           this.exportFile(type);
        });
      });
    }

    if (this.options.selectable && this.dom.thead) {
        const selectAll = this.dom.thead.querySelector('.nt-select-all');
        if (selectAll) {
            selectAll.addEventListener('change', (e) => {
                const checked = e.target.checked;
                const rows = this.dom.tbody.querySelectorAll('.nt-select-row');
                rows.forEach(row => {
                    row.checked = checked;
                });
            });
        }
    }

    this.dom.ths.forEach(th => {
      th.addEventListener('click', () => {
        const index = th.dataset.index;
        const col = this.options.columns[index];
        const key = col.key;
        
        if (this.state.sortColumn === key) {
          if (this.state.sortDesc) {
            this.state.sortColumn = null;
            this.state.sortDesc = false;
          } else {
            this.state.sortDesc = true;
          }
        } else {
          this.state.sortColumn = key;
          this.state.sortDesc = false;
        }

        this.dom.ths.forEach(t => {
          const icon = t.querySelector('.nt-sort-icon');
          if (icon) icon.innerHTML = '';
        });
        if (this.state.sortColumn) {
          const icon = th.querySelector('.nt-sort-icon');
          if (icon) {
            icon.innerHTML = this.state.sortDesc ? '▾' : '▴';
          }
        }

        this.loadData();
      });
    });

    this.dom.prev.addEventListener('click', () => {
      if (this.state.page > 1) {
        this.state.page--;
        this.loadData();
      }
    });

    this.dom.next.addEventListener('click', () => {
      const maxPage = Math.ceil(this.state.total / this.options.pageSize);
      if (this.state.page < maxPage) {
        this.state.page++;
        this.loadData();
      }
    });

    if (this.dom.tbody) {
       this.dom.tbody.addEventListener('click', (e) => {
           const expandBtn = e.target.closest('.nt-expand-btn');
           if (expandBtn) {
               const tr = expandBtn.closest('tr');
               if (expandBtn.classList.contains('open')) {
                   expandBtn.classList.remove('open');
                   const next = tr.nextElementSibling;
                   if (next && next.classList.contains('nt-child-row')) {
                       next.remove();
                   }
               } else {
                   expandBtn.classList.add('open');
                   const index = parseInt(tr.dataset.index, 10);
                   const row = this.state.displayData[index];
                   
                   let detailsHtml = '<div class="nt-child-details">';
                   this.hiddenColumns.forEach(i => {
                       const col = this.options.columns[i];
                       let val = row[`_${col.key}_text`] !== undefined ? row[`_${col.key}_text`] : row[col.key];
                       if (col.render) {
                           val = col.render(val, row);
                       } else {
                           val = this.escapeHTML(val);
                       }
                       detailsHtml += `<div class="nt-child-detail"><span class="nt-child-title">${this.escapeHTML(col.title)}:</span> <span class="nt-child-value">${val !== null && val !== undefined ? val : ''}</span></div>`;
                   });
                   detailsHtml += '</div>';
                   
                   const childTr = document.createElement('tr');
                   childTr.className = 'nt-child-row';
                   childTr.innerHTML = `<td colspan="${this.options.columns.length}">${detailsHtml}</td>`;
                   tr.parentNode.insertBefore(childTr, tr.nextSibling);
               }
           }
       });
    }
  }

  initResponsive() {
    this.hiddenColumns = [];
    if (!this.options.responsive) return;
    let timeout;
    let lastWidth = 0;
    const observer = new ResizeObserver((entries) => {
       const width = entries[0].contentRect.width;
       if (width === lastWidth) return;
       lastWidth = width;
       clearTimeout(timeout);
       timeout = setTimeout(() => this.checkResponsive(), 50);
    });
    if (this.dom.wrapper) observer.observe(this.dom.wrapper);
  }

  checkResponsive() {
    if (!this.options.responsive || !this.dom.wrapper) return;
    if (this.options.columns.length <= 2) return;
    
    const tableContainer = this.dom.wrapper.querySelector('.nt-table-container');
    const table = this.dom.wrapper.querySelector('.nt-table');
    if (!table || !tableContainer) return;

    const ths = table.querySelectorAll('th');
    
    // 1. Reset all data columns to visible
    this.hiddenColumns = [];
    ths.forEach(th => th.style.display = '');
    const rows = table.querySelectorAll('tbody tr:not(.nt-child-row)');
    rows.forEach(tr => {
       Array.from(tr.children).forEach(td => td.style.display = '');
    });
    table.querySelectorAll('.nt-child-row').forEach(row => row.remove());
    
    // 2. HIDE the expand column (+) by default
    if (ths[0]) ths[0].style.display = 'none';
    rows.forEach(tr => {
       if (tr.children[0]) tr.children[0].style.display = 'none';
       const btn = tr.children[0]?.querySelector('.nt-expand-btn');
       if (btn) btn.classList.remove('open');
    });

    // 3. Let CSS try to wrap the text. Then, check if it STILL overflows.
    let isOverflowing = () => tableContainer.scrollWidth > tableContainer.clientWidth;
    
    if (isOverflowing()) {
       // 4. It doesn't fit! Start hiding columns from right to left.
       for (let i = this.options.columns.length - 1; i >= 0; i--) {
           const col = this.options.columns[i];
           if (col.key === '_expand' || col.key === '_checkbox') continue;
           
           this.hiddenColumns.push(i);
           
           if (ths[i]) ths[i].style.display = 'none';
           rows.forEach(tr => {
               if (tr.children[i]) tr.children[i].style.display = 'none';
           });
           
           // Check if hiding that column fixed the overflow
           if (!isOverflowing()) {
               break; 
           }
       }
    }
    
    // 5. If we were forced to hide ANY columns, reveal the expand (+) column
    if (this.hiddenColumns.length > 0) {
       if (ths[0]) ths[0].style.display = '';
       rows.forEach(tr => {
           if (tr.children[0]) tr.children[0].style.display = '';
       });
    }
  }

  async loadData() {
    if (this.dom.loader) this.dom.loader.classList.add('show');
    
    if (this.options.serverSide && this.options.ajax) {
      try {
        const params = {
          page: parseInt(this.state.page, 10),
          pageSize: parseInt(this.options.pageSize, 10),
          search: this.state.search,
          sortColumn: this.state.sortColumn,
          sortDesc: Boolean(this.state.sortDesc)
        };
        
        if (typeof this.options.ajax === 'function') {
          const res = await this.options.ajax(params);
          this.state.displayData = res.data || [];
          this.state.total = parseInt(res.total, 10) || 0;
        } else {
          const url = typeof this.options.ajax === 'string' ? this.options.ajax : this.options.ajax.url;
          const method = (typeof this.options.ajax === 'object' && this.options.ajax.method) ? this.options.ajax.method.toUpperCase() : 'GET';
          
          let fetchUrl = url;
          let fetchOptions = { method };
          
          if (method === 'GET') {
             const urlObj = new URL(url, window.location.origin);
             Object.keys(params).forEach(k => {
               if (params[k] !== null && params[k] !== undefined && params[k] !== '') {
                 urlObj.searchParams.append(k, params[k]);
               }
             });
             fetchUrl = urlObj.toString();
          } else {
             fetchOptions.headers = { 'Content-Type': 'application/json' };
             fetchOptions.body = JSON.stringify(params);
          }
          
          const response = await fetch(fetchUrl, fetchOptions);
          const res = await response.json();
          this.state.displayData = res.data || [];
          this.state.total = parseInt(res.total, 10) || 0;
        }
      } catch (e) {
        console.error('NanoTable data fetch failed:', e);
      }
    } else {
      let data = [...this.options.data];

      if (this.state.search) {
        const query = this.state.search.toLowerCase();
        data = data.filter(row => {
          return this.options.columns.some(col => {
            if (col.key === '_checkbox' || col.key === '_expand') return false;
            if (!this.searchableKeys.includes(col.key)) return false;
            const val = row[`_${col.key}_text`] !== undefined ? row[`_${col.key}_text`] : row[colKey];
            return val != null && String(val).toLowerCase().includes(query);
          });
        });
      }

      if (this.state.sortColumn && this.state.sortColumn !== '_checkbox') {
        data.sort((a, b) => {
          let valA = a[`_${this.state.sortColumn}_text`] !== undefined ? a[`_${this.state.sortColumn}_text`] : a[this.state.sortColumn];
          let valB = b[`_${this.state.sortColumn}_text`] !== undefined ? b[`_${this.state.sortColumn}_text`] : b[this.state.sortColumn];
          if (typeof valA === 'string') valA = valA.toLowerCase();
          if (typeof valB === 'string') valB = valB.toLowerCase();
          
          if (valA < valB) return this.state.sortDesc ? 1 : -1;
          if (valA > valB) return this.state.sortDesc ? -1 : 1;
          return 0;
        });
      }

      this.state.total = data.length;
      const start = (this.state.page - 1) * this.options.pageSize;
      this.state.displayData = data.slice(start, start + this.options.pageSize);
    }

    this.renderRows();
    this.updatePagination();
    
    if (this.dom.loader) this.dom.loader.classList.remove('show');
  }

  renderRows() {
    if (!this.dom.tbody) return;
    
    if (this.state.displayData.length === 0) {
      this.dom.tbody.innerHTML = `<tr><td colspan="${this.options.columns.length}" style="text-align:center; padding: 32px; color: #64748b;">No records found matching your criteria.</td></tr>`;
      return;
    }

    this.dom.tbody.innerHTML = this.state.displayData.map((row, i) => {
      return `<tr data-index="${i}">
        ${this.options.columns.map(col => {
          const content = col.render ? col.render(row[col.key], row) : this.escapeHTML(row[col.key] || '');
          return `<td>${content}</td>`;
        }).join('')}
      </tr>`;
    }).join('');
    
    const rowCheckboxes = this.dom.tbody.querySelectorAll('.nt-select-row');
    if (rowCheckboxes.length > 0 && this.dom.thead) {
       const selectAll = this.dom.thead.querySelector('.nt-select-all');
       if (selectAll) selectAll.checked = false;
       rowCheckboxes.forEach(cb => {
           cb.addEventListener('change', () => {
               if (selectAll) {
                   const allChecked = Array.from(rowCheckboxes).every(c => c.checked);
                   const someChecked = Array.from(rowCheckboxes).some(c => c.checked);
                   selectAll.checked = allChecked;
                   selectAll.indeterminate = someChecked && !allChecked;
               }
           });
       });
    }
    
    this.checkResponsive();
  }

  updatePagination() {
    const start = (this.state.page - 1) * this.options.pageSize + 1;
    const end = Math.min(this.state.page * this.options.pageSize, this.state.total);
    
    if (this.state.total === 0) {
      this.dom.info.textContent = 'Showing 0 to 0 of 0 entries';
    } else {
      this.dom.info.textContent = `Showing ${start} to ${end} of ${this.state.total} entries`;
    }

    const maxPage = Math.ceil(this.state.total / this.options.pageSize);
    this.dom.prev.disabled = this.state.page === 1;
    this.dom.next.disabled = this.state.page >= maxPage || maxPage === 0;
    
    let pagesHtml = '';
    for (let i = 1; i <= maxPage; i++) {
        if (maxPage > 7) {
           if (i === 1 || i === maxPage || (i >= this.state.page - 1 && i <= this.state.page + 1)) {
              pagesHtml += `<button class="nt-page-btn ${i === this.state.page ? 'active' : ''}" data-page="${i}">${i}</button>`;
           } else if (i === this.state.page - 2 || i === this.state.page + 2) {
              pagesHtml += `<span style="padding: 0.5em;">…</span>`;
           }
        } else {
           pagesHtml += `<button class="nt-page-btn ${i === this.state.page ? 'active' : ''}" data-page="${i}">${i}</button>`;
        }
    }
    this.dom.pageInfo.innerHTML = pagesHtml;
    
    this.dom.pageInfo.querySelectorAll('.nt-page-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.state.page = parseInt(e.currentTarget.dataset.page, 10);
        this.loadData();
      });
    });
  }

  exportFile(type) {
    try {
      const dataToExport = this.options.serverSide ? this.state.displayData : this.options.data;
      const exportColumns = this.options.columns.filter(c => c.key !== '_checkbox' && c.key !== '_expand');
      
      if (type === 'pdf') {
         const printWindow = window.open('', '_blank');
         printWindow.document.write('<html><head><title>Export</title><style>table {width:100%;border-collapse:collapse} th,td {border:1px solid #ccc;padding:8px;text-align:left;font-family:sans-serif}</style></head><body>');
         printWindow.document.write('<table><thead><tr>');
         exportColumns.forEach(c => printWindow.document.write(`<th>${this.escapeHTML(c.title)}</th>`));
         printWindow.document.write('</tr></thead><tbody>');
         dataToExport.forEach(row => {
            printWindow.document.write('<tr>');
            exportColumns.forEach(c => {
                let val = row[`_${c.key}_text`] !== undefined ? row[`_${c.key}_text`] : row[c.key];
                printWindow.document.write(`<td>${this.escapeHTML(val !== undefined && val !== null ? val : '')}</td>`);
            });
            printWindow.document.write('</tr>');
         });
         printWindow.document.write('</tbody></table></body></html>');
         printWindow.document.close();
         printWindow.focus();
         setTimeout(() => printWindow.print(), 100);
         return;
      }
      
      let content = '';
      let mime = '';
      let filename = (this.options.exportFilename || 'export').replace(/\.[^/.]+$/, "");
      
      if (type === 'csv') {
          const headers = exportColumns.map(c => `"${String(c.title || '').replace(/"/g, '""')}"`).join(',');
          const rows = dataToExport.map(row => {
            return exportColumns.map(c => {
              let val = row[`_${c.key}_text`] !== undefined ? row[`_${c.key}_text`] : row[c.key];
              val = val !== undefined && val !== null ? val : '';
              return `"${String(val).replace(/"/g, '""')}"`;
            }).join(',');
          });
          content = [headers, ...rows].join('\n');
          mime = 'text/csv;charset=utf-8;';
          filename += '.csv';
      } else if (type === 'excel' || type === 'word') {
          const isWord = type === 'word';
          mime = isWord ? 'application/msword' : 'application/vnd.ms-excel';
          filename += isWord ? '.doc' : '.xls';
          let html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:${isWord ? 'word' : 'excel'}" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8" /></head><body><table border="1"><thead><tr>`;
          exportColumns.forEach(c => { html += `<th>${this.escapeHTML(c.title)}</th>`; });
          html += '</tr></thead><tbody>';
          dataToExport.forEach(row => {
              html += '<tr>';
              exportColumns.forEach(c => {
                  let val = row[`_${c.key}_text`] !== undefined ? row[`_${c.key}_text`] : row[c.key];
                  html += `<td>${this.escapeHTML(val !== undefined && val !== null ? val : '')}</td>`;
              });
              html += '</tr>';
          });
          html += '</tbody></table></body></html>';
          content = html;
      }
      
      if (content) {
          const blob = new Blob([content], { type: mime });
          const link = document.createElement('a');
          link.href = URL.createObjectURL(blob);
          link.setAttribute('download', filename);
          link.style.display = 'none';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
      }
    } catch (error) {
      console.error('NanoTable Export Error:', error);
      alert('There was an error exporting the file.');
    }
  }
}