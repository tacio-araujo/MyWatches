    let bancoDados = { relogios: [], caixas: [], ex_colecao: [], sobre: null };
    let fileSha = "";
    let abaAtiva = 'relogios';
    let modoVisualizacao = localStorage.getItem('mywatches_view_mode') || 'grid-1';
    let pendingChanges = { temPendencia: false, fotosParaEnviar: [], fotosParaExcluir: [], videosParaEnviar: [], videosParaExcluir: [] };
    let fotosRelogioAtual = [], fotosRelogioExcluir = [], fotosCaixaAtual = [], fotosCaixaExcluir = [];
    let videoRelogioAtual = null, videoRelogioExcluir = null, videoFileParaUpload = null;
    let chartMarcasInst = null, chartTiposInst = null, chartValoresInst = null, chartMovimentosInst = null, chartTimelineInst = null;
    let modoTimelineAtual = 'mes'; // Inicia em mês para dar visual rico
    let cacheRelogiosDashboard = [];
    let deferredPrompt = null;
    let debounceSearchTimer = null;
    let filtroPillAtivo = 'todos';
// --- CONTROLE DE MODO VISITANTE (COMPARTILHAMENTO) ---
const urlParams = new URLSearchParams(window.location.search);
const modoVisitante = urlParams.has('share');
  function copiarLinkCompartilhamento() {
  const urlLimpa = `${window.location.origin}${window.location.pathname}?share=true`;
  navigator.clipboard.writeText(urlLimpa).then(() => {
    alert("Link copiado! Quem abrir por esse link verá seu acervo em modo vitrine (sem botões de edição ou valores pagos).");
  }).catch(() => {
    prompt("Copie o link abaixo para compartilhar:", urlLimpa);
  });
}
    // INDEXEDDB PARA PERSISTÊNCIA OFFLINE/DRAFTS
    const DB_NAME = 'MyWatchesDB';
    const DB_VERSION = 1;
    function abrirDB() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('app_state')) {
            db.createObjectStore('app_state', { keyPath: 'chave' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    async function salvarEstadoLocalIndexedDB() {
      try {
        const db = await abrirDB();
        const tx = db.transaction('app_state', 'readwrite');
        const store = tx.objectStore('app_state');
        store.put({ chave: 'bancoDados', valor: bancoDados });
        store.put({ chave: 'pendingChanges', valor: pendingChanges });
      } catch (err) {
        console.warn('Erro ao persistir no IndexedDB:', err);
      }
    }
    async function restaurarEstadoLocalIndexedDB() {
      try {
        const db = await abrirDB();
        const tx = db.transaction('app_state', 'readonly');
        const store = tx.objectStore('app_state');
        const getBanco = () => new Promise(res => { const r = store.get('bancoDados'); r.onsuccess = () => res(r.result?.valor); });
        const getPend = () => new Promise(res => { const r = store.get('pendingChanges'); r.onsuccess = () => res(r.result?.valor); });
        
        const b = await getBanco();
        const p = await getPend();
        return { bancoLocal: b, pendenciasLocais: p };
      } catch (err) {
        return { bancoLocal: null, pendenciasLocais: null };
      }
    }
    async function limparEstadoLocalIndexedDB() {
      try {
        const db = await abrirDB();
        const tx = db.transaction('app_state', 'readwrite');
        tx.objectStore('app_state').clear();
      } catch (err) {}
    }
     // HELPERS PARA ANIMAÇÃO DE MODAIS
    function abrirModalSuave(modalId) {
      const el = document.getElementById(modalId);
      if (!el) return;
      el.classList.remove('modal-closed');
      lucide.createIcons();
    }

    function fecharModalSuave(modalId) {
      const el = document.getElementById(modalId);
      if (!el) return;
      el.classList.add('modal-closed');
    }

    const CONFIG = { 
      user: localStorage.getItem('gh_user') || 'tacio-araujo', 
      repo: localStorage.getItem('gh_repo') || 'MyWatches', 
      token: localStorage.getItem('gh_token') || '',
      geminiKey: localStorage.getItem('gemini_key') || '',
      groqKey: localStorage.getItem('groq_key') || ''
    };

    function salvarConfig(e) {
      e.preventDefault();
      CONFIG.user = document.getElementById('cfg-user').value.trim();
      CONFIG.repo = document.getElementById('cfg-repo').value.trim();
      CONFIG.token = document.getElementById('cfg-token').value.trim();
      CONFIG.geminiKey = document.getElementById('cfg-gemini-key').value.trim();
      CONFIG.groqKey = document.getElementById('cfg-groq-key').value.trim();
      
      localStorage.setItem('gh_user', CONFIG.user);
      localStorage.setItem('gh_repo', CONFIG.repo);
      localStorage.setItem('gh_token', CONFIG.token);
      localStorage.setItem('gemini_key', CONFIG.geminiKey);
      localStorage.setItem('groq_key', CONFIG.groqKey);
      
      fecharModalConfig();
      alert("Credenciais salvas com sucesso!");
    }

    function abrirModalConfig() {
      document.getElementById('cfg-user').value = CONFIG.user;
      document.getElementById('cfg-repo').value = CONFIG.repo;
      document.getElementById('cfg-token').value = CONFIG.token;
      document.getElementById('cfg-gemini-key').value = CONFIG.geminiKey;
      document.getElementById('cfg-groq-key').value = CONFIG.groqKey;
      abrirModalSuave('modal-config');
    }
    function fecharModalConfig() { fecharModalSuave('modal-config'); }
    window.addEventListener('beforeunload', (e) => {
      if (pendingChanges.temPendencia) { 
        e.preventDefault(); 
        e.returnValue = 'Existem alterações pendentes não sincronizadas com o GitHub. Deseja realmente sair?'; 
        return e.returnValue; 
      }
    });

    function atualizarStatusPendencias(alterado = true) {
      pendingChanges.temPendencia = alterado;
      const btnSync = document.getElementById('btn-sync-all');
      const badgeCount = document.getElementById('badge-sync-count');
      const totalPendencias = (
        pendingChanges.fotosParaEnviar.length + 
        pendingChanges.fotosParaExcluir.length +
        (pendingChanges.videosParaEnviar?.length || 0) +
        (pendingChanges.videosParaExcluir?.length || 0)
      ) || (alterado ? 1 : 0);

      if (alterado) { 
        btnSync.classList.remove('hidden'); 
        btnSync.classList.add('flex'); 
        badgeCount.innerText = totalPendencias; 
      } else { 
        btnSync.classList.add('hidden'); 
        btnSync.classList.remove('flex'); 
      }
    }

    function definirModoVisualizacao(modo) { 
      modoVisualizacao = modo; 
      localStorage.setItem('mywatches_view_mode', modo); 
      atualizarBotoesModoVisualizacao(); 
      aplicarFiltrosEOrdem();
      renderCaixas();
    }

    function atualizarBotoesModoVisualizacao() {
      ['grid-1','grid-2','grid-3','list'].forEach(m => {
        const btn = document.getElementById(`btn-view-${m}`);
        if (!btn) return;
        btn.className = (m === modoVisualizacao) ? "p-1 sm:p-1.5 rounded transition text-xs font-semibold bg-sky-500 text-slate-950 shadow-sm" : "p-1 sm:p-1.5 rounded transition text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-sky-600 dark:hover:text-sky-300";
      });
    }

    function inicializarTema() {
      const temaSalvo = localStorage.getItem('theme');
      if (temaSalvo === 'light') { 
        document.documentElement.classList.remove('dark'); 
        document.getElementById('meta-theme-color').setAttribute('content', '#f8fafc'); 
      } else { 
        document.documentElement.classList.add('dark'); 
        document.getElementById('meta-theme-color').setAttribute('content', '#03060a'); 
      }
    }
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault(); 
      deferredPrompt = e;
      const btn = document.getElementById('btn-pwa-install');
      if (btn) btn.classList.remove('hidden');
    });

    function instalarPWA() {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then((choiceResult) => {
        if (choiceResult.outcome === 'accepted') { 
          const btn = document.getElementById('btn-pwa-install'); 
        if (btn) btn.classList.add('hidden');         }
        deferredPrompt = null;
      });    }

    function formatarData(dataStr) {
      if (!dataStr) return "N/A";
      const partes = dataStr.split('-');
      if (partes.length === 3) return `${partes[2]}/${partes[1]}/${partes[0]}`;
      return dataStr;    }

    function classificarAquisicao(r) {
      if (r.tipo_aquisicao === 'compra' || r.tipo_aquisicao === 'presente') return r.tipo_aquisicao;
      const origem = ((r.origem || '') + '').toLowerCase();
      if (origem.includes('presente') || origem.includes('ganh') || origem.includes('gift') || origem.includes('dado por') || origem.includes('recebi')) return 'presente';
      return 'compra';    }

    function atualizarLabelValor() {
      const tipo = document.getElementById('tipo-aquisicao').value;
      const label = document.getElementById('label-valor');
      const origem = document.getElementById('origem');
      if (tipo === 'presente') { 
        label.innerText = 'Valor Estimado / Atribuído (R$)'; 
        origem.placeholder = 'Quem te deu?'; 
      } else { 
        label.innerText = 'Valor Pago (R$)'; 
        origem.placeholder = 'Onde comprou / Origem';       }    }

    function alternarAba(aba) {
      abaAtiva = aba;
      const btnRelogios = document.getElementById('tab-btn-relogios'), 
            btnCaixas = document.getElementById('tab-btn-caixas'), 
            btnGeral = document.getElementById('tab-btn-geral'), 
            btnGaleria = document.getElementById('tab-btn-galeria'),
            btnExColecao = document.getElementById('tab-btn-ex-colecao'),
            btnSobre = document.getElementById('tab-btn-sobre');

      const badgeRelogios = document.getElementById('badge-count-relogios'), 
            badgeCaixas = document.getElementById('badge-count-caixas'),
            badgeExColecao = document.getElementById('badge-count-ex-colecao');

      const viewRelogios = document.getElementById('view-relogios'), 
            viewCaixas = document.getElementById('view-caixas'), 
            viewGeral = document.getElementById('view-geral'), 
            viewGaleria = document.getElementById('view-galeria'),
            viewExColecao = document.getElementById('view-ex-colecao'),
            viewSobre = document.getElementById('view-sobre');

      const controlesRelogios = document.getElementById('controles-relogios');
      const pillsFiltros = document.getElementById('pills-filtros');
      const labelBtn = document.getElementById('label-btn-adicionar');
      const containerBtnAdicionar = labelBtn ? labelBtn.closest('button') : null;

      const estiloBaseInativo = "flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-lg text-xs font-semibold uppercase tracking-wider transition border border-slate-200 dark:border-[#1b2f4d] bg-white dark:bg-[#070e1a] text-slate-600 dark:text-slate-400 hover:border-slate-400";
      const estiloAtivoRelogios = "flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-lg text-xs font-semibold uppercase tracking-wider transition border border-sky-500 bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 shadow-[0_0_15px_rgba(56,189,248,0.2)]";
      const estiloAtivoCaixas = "flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-lg text-xs font-semibold uppercase tracking-wider transition border border-amber-500 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 shadow-[0_0_15px_rgba(245,158,11,0.2)]";
      const estiloAtivoGeral = "flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-lg text-xs font-semibold uppercase tracking-wider transition border border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 shadow-[0_0_15px_rgba(160,185,129,0.2)]";
      const estiloAtivoGaleria = "flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-lg text-xs font-semibold uppercase tracking-wider transition border border-purple-500 bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 shadow-[0_0_15px_rgba(168,85,247,0.2)]";
      const estiloAtivoExColecao = "flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-lg text-xs font-semibold uppercase tracking-wider transition border border-slate-400 bg-slate-100 dark:bg-slate-800/60 text-slate-800 dark:text-slate-200 shadow-[0_0_15px_rgba(148,163,184,0.15)]";
      const estiloAtivoSobre = "flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-lg text-xs font-semibold uppercase tracking-wider transition border border-rose-500 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 shadow-[0_0_15px_rgba(244,63,94,0.2)]";

      // Aplica classes de abas
      if (btnRelogios) btnRelogios.className = aba === 'relogios' ? estiloAtivoRelogios : estiloBaseInativo;
      if (btnCaixas) btnCaixas.className = aba === 'caixas' ? estiloAtivoCaixas : estiloBaseInativo;
      if (btnGeral) btnGeral.className = aba === 'geral' ? estiloAtivoGeral : estiloBaseInativo;
      if (btnGaleria) btnGaleria.className = aba === 'galeria' ? estiloAtivoGaleria : estiloBaseInativo;
      if (btnExColecao) btnExColecao.className = aba === 'ex-colecao' ? estiloAtivoExColecao : estiloBaseInativo;
      if (btnSobre) btnSobre.className = aba === 'sobre' ? estiloAtivoSobre : estiloBaseInativo;

      // Badges
      if (badgeRelogios) badgeRelogios.className = aba === 'relogios' ? "ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-sky-500 text-white dark:text-slate-950 font-bold" : "ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300";
      if (badgeCaixas) badgeCaixas.className = aba === 'caixas' ? "ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-amber-500 text-white dark:text-slate-950 font-bold" : "ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300";
      if (badgeExColecao) badgeExColecao.className = aba === 'ex-colecao' ? "ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-slate-500 text-white font-bold" : "ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300";

      // Exibição de Views
      if (viewRelogios) viewRelogios.classList.toggle('hidden', aba !== 'relogios');
      if (viewCaixas) viewCaixas.classList.toggle('hidden', aba !== 'caixas');      
      if (viewGeral) viewGeral.classList.toggle('hidden', aba !== 'geral');
      if (viewGaleria) viewGaleria.classList.toggle('hidden', aba !== 'galeria');
      if (viewExColecao) viewExColecao.classList.toggle('hidden', aba !== 'ex-colecao');
      if (viewSobre) viewSobre.classList.toggle('hidden', aba !== 'sobre');

      // Controles e filtros (só aparecem na aba relógios)
      if (controlesRelogios) controlesRelogios.classList.toggle('hidden', aba !== 'relogios');
      if (pillsFiltros) pillsFiltros.classList.toggle('hidden', aba !== 'relogios');

      // Botão de adicionar
      if (labelBtn) {
        if (aba === 'relogios') labelBtn.innerText = "Adicionar Relógio";
        else if (aba === 'caixas') labelBtn.innerText = "Adicionar Caixa";
        else labelBtn.innerText = "Novo Item";
      }

      // Oculta o botão adicionar em abas que não têm criação rápida
      if (containerBtnAdicionar) {
        containerBtnAdicionar.classList.toggle('hidden', aba === 'geral' || aba === 'sobre' || aba === 'ex-colecao');
      }

      // Execuções específicas de cada aba
      if (aba === 'geral' && typeof carregarDashboardGeral === 'function') carregarDashboardGeral();
      if (aba === 'galeria' && typeof renderizarGaleria === 'function') renderizarGaleria();
      if (aba === 'ex-colecao' && typeof renderizarExColecao === 'function') renderizarExColecao();
      if (aba === 'sobre' && typeof renderizarSobre === 'function') renderizarSobre();

      if (window.lucide) lucide.createIcons();
    }

    function acaoBotaoAdicionar() {
      if (abaAtiva === 'caixas') {
        abrirModalCaixa();
      } else {
        if (abaAtiva !== 'relogios') alternarAba('relogios');
        abrirModalCadastro();      }    }

        async function carregarDados() {
      const tempoInicioCarregamento = Date.now();
      const { bancoLocal, pendenciasLocais } = await restaurarEstadoLocalIndexedDB();
      if (pendenciasLocais && pendenciasLocais.temPendencia && bancoLocal) {
        bancoDados = bancoLocal;
        pendingChanges = pendenciasLocais;
        atualizarStatusPendencias(true);
      } else {
        try {
          const resLocal = await fetch(`relogios.json?t=${Date.now()}`);
          if (!resLocal.ok) throw new Error("Erro local");
          const json = await resLocal.json();
          processarDadosRecebidos(json);
        } catch (e) {
          try {
            const res = await fetch(`https://api.github.com/repos/${CONFIG.user}/${CONFIG.repo}/contents/relogios.json`);
            const data = await res.json();
            fileSha = data.sha;
            const decoded = decodeURIComponent(escape(atob(data.content)));
            processarDadosRecebidos(JSON.parse(decoded));
          } catch (err) { 
            bancoDados = { relogios: [], caixas: [] }; 
          }
        }
      }
      atualizarBotoesModoVisualizacao();
      atualizarBotoesFiltroGaleria();
      renderizarPillsFiltros();
      renderizarTudo();
      alternarAba('relogios');
      
      // PASSO 3: TRAVAS DO MODO VISITANTE (?share=true)
      if (modoVisitante) {
        // 1. Oculta botões de gestão no topo
        document.getElementById('btn-sync-all')?.classList.add('hidden');
        document.getElementById('btn-compartilhar-acervo')?.classList.add('hidden');
        document.querySelector('[onclick*="abrirModalConfig"]')?.classList.add('hidden');
        document.querySelector('[onclick*="acaoBotaoAdicionar"]')?.classList.add('hidden');

        // 2. Injeta CSS para sumir botões de editar nos cards e valores no Dashboard
  const styleVisitante = document.createElement('style');
  styleVisitante.innerHTML = `
    button[onclick*="editarRelogio"],
    button[onclick*="editarCaixa"],
    button[onclick*="abrirModalCaixa"],
    button[onclick*="abrirModalCadastro"],
    #metric-valor-total-acervo,
    #metric-valor-comprados,
    #metric-valor-presentes,
    #metric-preco-medio-real,
    #chartValores,
    .valor-sigiloso {
      display: none !important;
    }
  `;
  document.head.appendChild(styleVisitante);
}

      // Esconder splash screen garantindo exibição mínima de 3 segundos
      const splash = document.getElementById('app-splash-loader');
      if (splash) {
        const tempoDecorrido = Date.now() - tempoInicioCarregamento;
        const tempoRestante = Math.max(0, 5000 - tempoDecorrido);
        setTimeout(() => {
          splash.classList.add('opacity-0');
          setTimeout(() => splash.classList.add('hidden'), 700);
        }, tempoRestante);
      }
    } // <-- Fecha carregarDados aqui

    function abrirModalCaixa() {

      document.getElementById('form-caixa').reset();
      document.getElementById('edit-caixa-id').value = '';
      document.getElementById('modal-caixa-title').innerText = "Cadastrar Caixa";
      const btnDel = document.getElementById('btn-excluir-modal-caixa');
      if (btnDel) {
        btnDel.classList.add('hidden');
        btnDel.classList.remove('flex');
      }
      fotosCaixaAtual = []; fotosCaixaExcluir = [];
      renderGerenciadorFotosCaixa();
      abrirModalSuave('modal-caixa');
    }
    function fecharModalCaixa() { fecharModalSuave('modal-caixa'); }

    function editarCaixa(id) {
      const c = bancoDados.caixas.find(item => item.id === id);
      if (!c) return;
      
      const fileInp = document.getElementById('caixa-fotos-files');
      if (fileInp) fileInp.value = '';

      document.getElementById('modal-caixa-title').innerText = `Editar Caixa: ${c.nome}`;
      document.getElementById('edit-caixa-id').value = c.id;

      const btnDel = document.getElementById('btn-excluir-modal-caixa');
      if (btnDel) {
      btnDel.classList.remove('hidden');
      btnDel.classList.add('flex');      }
      document.getElementById('caixa-nome').value = c.nome || '';
      document.getElementById('caixa-capacidade').value = c.capacidade || '';
      document.getElementById('caixa-data').value = c.data_aquisicao || '';
      document.getElementById('caixa-status').value = c.status || '';
      document.getElementById('caixa-obs').value = c.observacoes || '';
      fotosCaixaAtual = [...(c.fotos || [])];
      fotosCaixaExcluir = [];
      renderGerenciadorFotosCaixa();
      abrirModalSuave('modal-caixa');
      lucide.createIcons();
    }

    function excluirCaixaModalAtual() {
      const id = document.getElementById('edit-caixa-id').value;
      if (!id) return;
      fecharModalCaixa();
      removerCaixa(id);    
    }
    function abrirDetalhesCaixa(id) {
      const c = bancoDados.caixas.find(item => item.id === id);
      if (!c) return;
      document.getElementById('detalhe-marca').innerText = 'Estojo / Caixa';
      document.getElementById('detalhe-modelo').innerText = c.nome;
      document.getElementById('detalhe-foto').src = (c.fotos && c.fotos[0]) ? c.fotos[0] : 'https://placehold.co/600x600/0a1322/38bdf8?text=Sem+Foto';
      document.getElementById('btn-ver-todas-fotos').onclick = () => { fecharModalDetalhes(); abrirGaleriaCaixa(c.id); };
      const grid = document.getElementById('detalhes-grid');
      const campos = [
        { label: 'Capacidade Total', valor: `${c.capacidade || 0} slots`, destaque: true },
        { label: 'Status Atual', valor: c.status || 'Ativa' },
        { label: 'Data de Aquisição', valor: formatarData(c.data_aquisicao) },
        { label: 'Total de Registros/Fotos', valor: `${(c.fotos || []).length} fotos` }
      ];
      grid.innerHTML = campos.map(item => `
        <div class="flex justify-between py-1 border-b border-slate-200 dark:border-[#14233a]">
          <span class="text-slate-500 dark:text-slate-400">${item.label}:</span>
          <span class="${item.destaque ? 'text-amber-500 font-semibold' : 'text-slate-800 dark:text-slate-100'}">${item.valor}</span>
        </div>
      `).join('');

      const boxDesc = document.getElementById('detalhe-box-descricao');
      if (c.observacoes && c.observacoes.trim()) {
        document.getElementById('detalhe-descricao').innerText = c.observacoes;
        boxDesc.classList.remove('hidden');
      } else {
        boxDesc.classList.add('hidden');
      }

      document.getElementById('detalhe-box-historia').classList.add('hidden');
      const boxVid = document.getElementById('detalhe-box-video');
      if (boxVid) boxVid.classList.add('hidden');

      abrirModalSuave('modal-detalhes');
      lucide.createIcons();
    }
    function processarDadosRecebidos(json) {
      if (Array.isArray(json)) { 
        bancoDados = { relogios: json, caixas: [], ex_colecao: [], sobre: null }; 
      } else { 
        bancoDados = { 
          relogios: json.relogios || [], 
          caixas: json.caixas || [],
          ex_colecao: json.ex_colecao || [],
          sobre: json.sobre || null 
        }; 
      }

      bancoDados.relogios.forEach(r => {
        if (!r.fotos && r.foto) r.fotos = [r.foto];
        if (!r.fotos) r.fotos = [];
        if (r.ordem === undefined) r.ordem = 999;
        r.tipo_aquisicao = classificarAquisicao(r);
        if (r.prestigio === undefined || r.afeto === undefined || r.valor_rating === undefined) {
          const oldTipo = r.rating_tipo, oldValor = parseInt(r.rating_valor) || 5;
          r.prestigio = (oldTipo === 'star') ? oldValor : (parseInt(r.prestigio) || 5);
          r.afeto = (oldTipo === 'heart') ? oldValor : (parseInt(r.afeto) || 5);
          r.valor_rating = (oldTipo === 'dollar') ? oldValor : (parseInt(r.valor_rating) || 5);
        }
        r.prestigio = Math.max(1, Math.min(5, parseInt(r.prestigio) || 5));
        r.afeto = Math.max(1, Math.min(5, parseInt(r.afeto) || 5));
        r.valor_rating = Math.max(1, Math.min(5, parseInt(r.valor_rating) || 5));
      });
      bancoDados.caixas.forEach(c => { if (!c.fotos) c.fotos = []; });
    }

    async function obterShaAtual() {
      if (!CONFIG.token) return;
      const res = await fetch(`https://api.github.com/repos/${CONFIG.user}/${CONFIG.repo}/contents/relogios.json`, { headers: { Authorization: `token ${CONFIG.token}` } });
      if (res.ok) { 
        const data = await res.json(); 
        fileSha = data.sha; 
      }
    }

    async function deletarArquivoFisicoGithub(urlFoto) {
      if (!CONFIG.token || !urlFoto || urlFoto.startsWith('data:') || urlFoto.startsWith('blob:')) return;
      try {
        const match = urlFoto.match(/(images|videos)\/[^?#]+/);
        if (!match) return;
        const filePath = match[0];
        const resCheck = await fetch(`https://api.github.com/repos/${CONFIG.user}/${CONFIG.repo}/contents/${filePath}`, { headers: { Authorization: `token ${CONFIG.token}` } });
        if (!resCheck.ok) return;
        const fileData = await resCheck.json();
        await fetch(`https://api.github.com/repos/${CONFIG.user}/${CONFIG.repo}/contents/${filePath}`, {
          method: 'DELETE', 
          headers: { Authorization: `token ${CONFIG.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: `chore: deletar ${filePath}`, sha: fileData.sha })
        });
      } catch (err) { 
        console.warn("Falha ao deletar arquivo:", err); 
      }
    }

    function renderTriRatingBadge(r, compacto = false) {
      const p = Math.max(1, Math.min(5, parseInt(r.prestigio) || 5));
      const a = Math.max(1, Math.min(5, parseInt(r.afeto) || 5));
      const v = Math.max(1, Math.min(5, parseInt(r.valor_rating) || 5));
      const shell = 'bg-black/80 backdrop-blur border border-slate-700/60 rounded-full font-bold z-10 pointer-events-none';
      if (compacto) {
        return `<span class="${shell} flex items-center gap-1 px-1.5 py-0.5"><span class="text-amber-400 text-[9px] leading-none">★${p}</span><span class="text-rose-400 text-[9px] leading-none">♥${a}</span><span class="text-emerald-400 text-[9px] leading-none">$${v}</span></span>`;
      }
      return `<span class="absolute top-2.5 right-2.5 ${shell} flex items-center gap-1.5 px-2 py-0.5"><span class="text-amber-400 text-[11px] leading-none">★ ${p}</span><span class="w-px h-3 bg-slate-700/70"></span><span class="text-rose-400 text-[11px] leading-none">♥ ${a}</span><span class="w-px h-3 bg-slate-700/70"></span><span class="text-emerald-400 text-[11px] leading-none">$ ${v}</span></span>`;
    }

    function renderizarTudo() {
      document.getElementById('badge-count-relogios').innerText = bancoDados.relogios.length;
      document.getElementById('badge-count-caixas').innerText = bancoDados.caixas.length;
      const badgeEx = document.getElementById('badge-count-ex-colecao');
      if (badgeEx) badgeEx.innerText = (bancoDados.ex_colecao || []).length;
      renderizarPillsFiltros();
      aplicarFiltrosEOrdem();
      renderCaixas();
      if (typeof renderizarExColecao === 'function') renderizarExColecao();
    }

    function mudarFotoCard(id, direcao, event) {
      event.stopPropagation();
      const r = bancoDados.relogios.find(item => item.id === id);
      if (!r || !r.fotos || r.fotos.length <= 1) return;
      const imgEl = document.getElementById(`card-img-${id}`), counterEl = document.getElementById(`card-photo-idx-${id}`);
      let currentIdx = parseInt(imgEl.dataset.idx || '0');
      currentIdx += direcao;
      if (currentIdx < 0) currentIdx = r.fotos.length - 1;
      if (currentIdx >= r.fotos.length) currentIdx = 0;
      imgEl.src = r.fotos[currentIdx]; 
      imgEl.dataset.idx = currentIdx;
      if (counterEl) counterEl.innerText = `${currentIdx + 1}/${r.fotos.length}`;
    }

    function mudarFotoCardCaixa(id, direcao, event) {
      event.stopPropagation();
      const c = bancoDados.caixas.find(item => item.id === id);
      if (!c || !c.fotos || c.fotos.length <= 1) return;
      const imgEl = document.getElementById(`caixa-card-img-${id}`), counterEl = document.getElementById(`caixa-card-photo-idx-${id}`);
      let currentIdx = parseInt(imgEl.dataset.idx || '0');
      currentIdx += direcao;
      if (currentIdx < 0) currentIdx = c.fotos.length - 1;
      if (currentIdx >= c.fotos.length) currentIdx = 0;
      imgEl.src = c.fotos[currentIdx]; 
      imgEl.dataset.idx = currentIdx;
      if (counterEl) counterEl.innerText = `${currentIdx + 1}/${c.fotos.length}`;
    }

    function renderRelogios(lista) {
      const grid = document.getElementById('grid-relogios');
      if (modoVisualizacao === 'grid-1') grid.className = "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-5";
      else if (modoVisualizacao === 'grid-2') grid.className = "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5 sm:gap-4";
      else if (modoVisualizacao === 'grid-3') grid.className = "grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 sm:gap-3";
      else if (modoVisualizacao === 'list') grid.className = "flex flex-col gap-2 sm:gap-2.5";

      if (lista.length === 0) {
        grid.innerHTML = `<div class="col-span-full py-16 text-center text-slate-500"><i data-lucide="watch" class="w-10 h-10 mx-auto mb-2 opacity-40"></i><p>Nenhum relógio encontrado.</p></div>`;
        lucide.createIcons(); 
        return;
      }

      grid.innerHTML = lista.map((r) => {
        const fotosQtd = r.fotos ? r.fotos.length : 0;
        const fotoPrincipal = fotosQtd > 0 ? r.fotos[0] : 'https://placehold.co/600x600/0a1322/38bdf8?text=Sem+Foto';

        if (modoVisualizacao === 'grid-1') {
          return `
            <div class="card-navy rounded-xl overflow-hidden flex flex-col justify-between">
              <div class="relative h-60 sm:h-64 overflow-hidden bg-slate-900 flex items-center justify-center group">
                <img id="card-img-${r.id}" data-idx="0" src="${fotoPrincipal}" alt="${r.modelo}" class="w-full h-full object-cover cursor-pointer hover:scale-105 transition duration-300" onclick="abrirGaleriaRelogio('${r.id}')" onerror="this.src='https://placehold.co/600x600/0a1322/38bdf8?text=Sem+Foto'">
                ${renderTriRatingBadge(r)}
                ${r.tipo_aquisicao === 'presente' ? `<span class="absolute top-2.5 left-2.5 bg-rose-500/90 text-white text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5 z-10 shadow"><i data-lucide="gift" class="w-3 h-3"></i> Presente</span>` : ''}
                ${r.tipo ? `<span class="absolute bottom-2.5 left-2.5 bg-black/75 border border-slate-700/60 text-slate-300 text-[10px] px-2 py-0.5 rounded tracking-wide z-10">${r.tipo}</span>` : ''}
                ${fotosQtd > 1 ? `
                  <button onclick="mudarFotoCard('${r.id}', -1, event)" title="Foto Anterior" class="absolute left-2 top-1/2 -translate-y-1/2 bg-black/60 hover:bg-black/85 text-white/80 hover:text-white border border-slate-700/50 p-2 sm:p-1.5 rounded-full backdrop-blur-sm transition opacity-90 sm:opacity-0 sm:group-hover:opacity-100 z-20"><i data-lucide="chevron-left" class="w-4 h-4"></i></button>
                  <button onclick="mudarFotoCard('${r.id}', 1, event)" title="Próxima Foto" class="absolute right-2 top-1/2 -translate-y-1/2 bg-black/60 hover:bg-black/85 text-white/80 hover:text-white border border-slate-700/50 p-2 sm:p-1.5 rounded-full backdrop-blur-sm transition opacity-90 sm:opacity-0 sm:group-hover:opacity-100 z-20"><i data-lucide="chevron-right" class="w-4 h-4"></i></button>
                  <span id="card-photo-idx-${r.id}" class="absolute bottom-2.5 right-2.5 bg-black/70 backdrop-blur text-[9px] text-slate-300 px-1.5 py-0.5 rounded font-mono z-10 pointer-events-none">1/${fotosQtd}</span>
                ` : ''}
              </div>
              <div class="p-3.5 sm:p-4 flex-1 flex flex-col justify-between">
                <div class="cursor-pointer group/title" onclick="abrirDetalhes('${r.id}')" title="Ver Ficha Técnica">
                  <div class="flex justify-between items-baseline">
                    <p class="text-[11px] uppercase tracking-widest text-sky-600 dark:text-sky-400 font-bold group-hover/title:text-sky-300 transition">${r.marca}</p>
                    <span class="text-[10px] text-slate-500 dark:text-slate-400 font-mono">${r.calibre || ''}</span>
                  </div>
                  <h3 class="text-sm font-semibold text-slate-900 dark:text-white tracking-tight mt-0.5 group-hover/title:text-sky-400 transition">${r.modelo}</h3>
                </div>
                <div class="mt-2.5 pt-2 border-t border-slate-200/80 dark:border-[#132238] flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                  <div class="flex items-center gap-1.5 truncate">
                    <i data-lucide="calendar" class="w-3.5 h-3.5 text-sky-500 flex-shrink-0"></i>
                    <span class="truncate">Entrou para a coleção: <strong class="text-slate-800 dark:text-slate-200 font-medium">${formatarData(r.data_compra)}</strong></span>
                  </div>
                  ${!modoVisitante ? `
                    <button onclick="editarRelogio('${r.id}')" title="Editar Relógio" class="p-1.5 rounded-lg text-slate-400 hover:text-sky-400 hover:bg-slate-100 dark:hover:bg-[#0c182b] transition flex-shrink-0 ml-2">
                      <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
                    </button>
                  ` : ''}
                </div>
              </div>
            </div>`;
        }

        if (modoVisualizacao === 'grid-2') {
          return `
            <div class="card-navy rounded-xl overflow-hidden flex flex-col justify-between">
              <div class="relative h-36 sm:h-44 overflow-hidden bg-slate-900 flex items-center justify-center group">
                <img id="card-img-${r.id}" data-idx="0" src="${fotoPrincipal}" alt="${r.modelo}" class="w-full h-full object-cover cursor-pointer hover:scale-105 transition duration-300" onclick="abrirGaleriaRelogio('${r.id}')" onerror="this.src='https://placehold.co/600x600/0a1322/38bdf8?text=Sem+Foto'">
                <div class="absolute top-1.5 right-1.5">${renderTriRatingBadge(r, true)}</div>
                ${r.tipo_aquisicao === 'presente' ? `<span class="absolute top-1.5 left-1.5 bg-rose-500/90 text-white p-1 rounded-full flex items-center justify-center z-10 shadow" title="Presente"><i data-lucide="gift" class="w-3 h-3"></i></span>` : ''}
                ${fotosQtd > 1 ? `
                  <button onclick="mudarFotoCard('${r.id}', -1, event)" class="absolute left-1 top-1/2 -translate-y-1/2 bg-black/60 text-white p-1 rounded-full opacity-80 sm:opacity-0 sm:group-hover:opacity-100 transition z-20"><i data-lucide="chevron-left" class="w-3 h-3"></i></button>
                  <button onclick="mudarFotoCard('${r.id}', 1, event)" class="absolute right-1 top-1/2 -translate-y-1/2 bg-black/60 text-white p-1 rounded-full opacity-80 sm:opacity-0 sm:group-hover:opacity-100 transition z-20"><i data-lucide="chevron-right" class="w-3 h-3"></i></button>
                ` : ''}
              </div>
              <div class="p-2 sm:p-2.5 flex-1 flex flex-col justify-between">
                <div class="cursor-pointer group/title" onclick="abrirDetalhes('${r.id}')" title="Ver Ficha Técnica">
                  <p class="text-[9px] uppercase tracking-wider text-sky-600 dark:text-sky-400 font-bold truncate group-hover/title:text-sky-300 transition">${r.marca}</p>
                  <h3 class="text-xs font-semibold text-slate-900 dark:text-white truncate group-hover/title:text-sky-400 transition">${r.modelo}</h3>
                </div>
                <div class="mt-2 pt-1.5 border-t border-slate-200/80 dark:border-[#132238] flex items-center justify-between text-[9px] text-slate-400">
                  <span class="truncate">${formatarData(r.data_compra)}</span>
                  ${!modoVisitante ? `
                    <button onclick="editarRelogio('${r.id}')" title="Editar" class="p-1 rounded text-slate-400 hover:text-sky-400 hover:bg-slate-100 dark:hover:bg-[#0c182b] transition flex-shrink-0">
                      <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
                    </button>
                  ` : ''}
                </div>
              </div>
            </div>`;
        }

        if (modoVisualizacao === 'grid-3') {
          return `
            <div class="card-navy rounded-lg overflow-hidden flex flex-col justify-between">
              <div class="relative h-24 sm:h-32 overflow-hidden bg-slate-900 cursor-pointer group" onclick="abrirGaleriaRelogio('${r.id}')" title="Ver Fotos">
                <img src="${fotoPrincipal}" alt="${r.modelo}" class="w-full h-full object-cover group-hover:scale-105 transition duration-300" onerror="this.src='https://placehold.co/600x600/0a1322/38bdf8?text=Sem+Foto'">
                <div class="absolute top-1 right-1">${renderTriRatingBadge(r, true)}</div>
                ${r.tipo_aquisicao === 'presente' ? `<span class="absolute top-1 left-1 bg-rose-500/90 text-white p-0.5 rounded-full flex items-center justify-center z-10 shadow" title="Presente"><i data-lucide="gift" class="w-2.5 h-2.5"></i></span>` : ''}
              </div>
              <div class="p-1.5 flex flex-col justify-between">
                <div class="cursor-pointer group/title" onclick="abrirDetalhes('${r.id}')" title="Ver Ficha Técnica">
                  <p class="text-[8px] uppercase tracking-tighter text-sky-500 font-bold truncate group-hover/title:text-sky-300 transition">${r.marca}</p>
                  <h4 class="text-[10px] font-semibold text-slate-900 dark:text-white truncate group-hover/title:text-sky-400 transition">${r.modelo}</h4>
                </div>
                <div class="mt-1 flex items-center justify-between pt-1 border-t border-slate-200/80 dark:border-[#132238] text-[8px] text-slate-400">
                  <span class="truncate">${formatarData(r.data_compra)}</span>
                  ${!modoVisitante ? `
                    <button onclick="editarRelogio('${r.id}')" title="Editar" class="text-slate-400 hover:text-sky-400 p-0.5 transition flex-shrink-0">
                      <i data-lucide="edit-3" class="w-3 h-3"></i>
                    </button>
                  ` : ''}
                </div>
              </div>
            </div>`;
        }

        if (modoVisualizacao === 'list') {
          return `
            <div class="card-navy rounded-xl p-2 sm:p-2.5 flex items-center justify-between gap-2.5">
              <div class="flex items-center gap-2.5 min-w-0">
                <img src="${fotoPrincipal}" alt="${r.modelo}" class="w-14 h-14 sm:w-16 sm:h-16 rounded-lg object-cover bg-slate-900 flex-shrink-0 cursor-pointer hover:opacity-90 transition" onclick="abrirGaleriaRelogio('${r.id}')" title="Ver Fotos" onerror="this.src='https://placehold.co/600x600/0a1322/38bdf8?text=Sem+Foto'">
                <div class="min-w-0 cursor-pointer group/title" onclick="abrirDetalhes('${r.id}')" title="Ver Ficha Técnica">
                  <div class="flex items-center gap-1.5">
                    <span class="text-[10px] uppercase tracking-wider text-sky-600 dark:text-sky-400 font-bold truncate group-hover/title:text-sky-300 transition">${r.marca}</span>
                    ${renderTriRatingBadge(r, true)}
                    ${r.tipo_aquisicao === 'presente' ? `<span class="bg-rose-500/90 text-white text-[8px] font-bold px-1 py-0.5 rounded flex items-center gap-0.5 shadow flex-shrink-0" title="Presente"><i data-lucide="gift" class="w-2.5 h-2.5"></i></span>` : ''}
                  </div>
                  <h3 class="text-xs sm:text-sm font-semibold text-slate-900 dark:text-white truncate group-hover/title:text-sky-400 transition">${r.modelo}</h3>
                  <div class="flex flex-wrap items-center gap-x-2 text-[10px] text-slate-400 mt-0.5">
                    <span>${formatarData(r.data_compra)}</span>
                    ${r.calibre ? `<span class="hidden sm:inline font-mono text-slate-300 dark:text-slate-400">• ${r.calibre}</span>` : ''}
                    ${(!modoVisitante && r.valor) ? `<span class="text-emerald-500 font-semibold">• ${r.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>` : ''}
                  </div>
                </div>
              </div>
              <div class="flex items-center flex-shrink-0">
                ${!modoVisitante ? `
                  <button onclick="editarRelogio('${r.id}')" title="Editar" class="p-2 rounded-lg bg-slate-100 dark:bg-[#0b1626] border border-slate-200 dark:border-[#1b2f4d] text-slate-400 hover:text-sky-500 transition">
                    <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
                  </button>
                ` : ''}
              </div>
            </div>`;
        }
      }).join('');
      lucide.createIcons();
    }

    function renderCaixas() {
      const grid = document.getElementById('grid-caixas');
      if (!grid) return;

      if (modoVisualizacao === 'grid-1') grid.className = "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-5";
      else if (modoVisualizacao === 'grid-2') grid.className = "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5 sm:gap-4";
      else if (modoVisualizacao === 'grid-3') grid.className = "grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 sm:gap-3";
      else if (modoVisualizacao === 'list') grid.className = "flex flex-col gap-2 sm:gap-2.5";

      if (bancoDados.caixas.length === 0) {
        grid.innerHTML = `<div class="col-span-full py-16 text-center text-slate-500"><i data-lucide="package" class="w-10 h-10 mx-auto mb-2 opacity-40"></i><p>Nenhuma caixa catalogada.</p><button onclick="abrirModalCaixa()" class="mt-2 text-amber-500 hover:underline text-xs">Adicionar a primeira caixa</button></div>`;
        lucide.createIcons(); 
        return;
      }

      grid.innerHTML = bancoDados.caixas.map((c) => {
        const fotosQtd = c.fotos ? c.fotos.length : 0;
        const fotoCapa = fotosQtd > 0 ? c.fotos[0] : 'https://placehold.co/800x500/0a1322/38bdf8?text=Sem+Foto';

        if (modoVisualizacao === 'grid-1') {
          return `
            <div class="card-navy rounded-xl overflow-hidden flex flex-col justify-between">
              <div class="relative h-60 sm:h-64 overflow-hidden bg-slate-900 flex items-center justify-center group">
                <img id="caixa-card-img-${c.id}" data-idx="0" src="${fotoCapa}" alt="${c.nome}" class="w-full h-full object-cover cursor-pointer hover:scale-105 transition duration-300" onclick="abrirGaleriaCaixa('${c.id}')" onerror="this.src='https://placehold.co/800x500/0a1322/38bdf8?text=Sem+Foto'">
                <span class="absolute top-2.5 right-2.5 bg-black/80 backdrop-blur border border-slate-700/60 px-2.5 py-1 rounded-full text-[10px] font-semibold text-amber-300 z-10">${c.capacidade} Posições</span>
                ${c.status ? `<span class="absolute bottom-2.5 left-2.5 bg-black/75 border border-slate-700/60 text-slate-300 text-[10px] px-2 py-0.5 rounded z-10">${c.status}</span>` : ''}
                ${fotosQtd > 1 ? `
                  <button onclick="mudarFotoCardCaixa('${c.id}', -1, event)" title="Foto Anterior" class="absolute left-2 top-1/2 -translate-y-1/2 bg-black/60 hover:bg-black/85 text-white/80 hover:text-white border border-slate-700/50 p-2 sm:p-1.5 rounded-full backdrop-blur-sm transition opacity-90 sm:opacity-0 sm:group-hover:opacity-100 z-20"><i data-lucide="chevron-left" class="w-4 h-4"></i></button>
                  <button onclick="mudarFotoCardCaixa('${c.id}', 1, event)" title="Próxima Foto" class="absolute right-2 top-1/2 -translate-y-1/2 bg-black/60 hover:bg-black/85 text-white/80 hover:text-white border border-slate-700/50 p-2 sm:p-1.5 rounded-full backdrop-blur-sm transition opacity-90 sm:opacity-0 sm:group-hover:opacity-100 z-20"><i data-lucide="chevron-right" class="w-4 h-4"></i></button>
                  <span id="caixa-card-photo-idx-${c.id}" class="absolute bottom-2.5 right-2.5 bg-black/70 backdrop-blur text-[9px] text-slate-300 px-1.5 py-0.5 rounded font-mono z-10 pointer-events-none">1/${fotosQtd}</span>
                ` : ''}
              </div>
              <div class="p-3.5 sm:p-4 flex-1 flex flex-col justify-between">
                <div class="cursor-pointer group/title" onclick="abrirDetalhesCaixa('${c.id}')" title="Ver Detalhes da Caixa">
                  <div class="flex justify-between items-baseline">
                    <p class="text-[11px] uppercase tracking-widest text-amber-600 dark:text-amber-400 font-bold group-hover/title:text-amber-300 transition">Estojo / Caixa</p>
                    <span class="text-[10px] text-slate-500 dark:text-slate-400 font-mono">${c.capacidade} slots</span>
                  </div>
                  <h3 class="text-sm font-semibold text-slate-900 dark:text-white tracking-tight mt-0.5 group-hover/title:text-amber-400 transition">${c.nome}</h3>
                  ${c.observacoes ? `<p class="text-[11px] text-slate-600 dark:text-slate-400 mt-1.5 line-clamp-2">${c.observacoes}</p>` : ''}
                </div>
                <div class="mt-2.5 pt-2 border-t border-slate-200/80 dark:border-[#132238] flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                  <div class="flex items-center gap-1.5 truncate">
                    <i data-lucide="calendar" class="w-3.5 h-3.5 text-amber-500 flex-shrink-0"></i>
                    <span class="truncate">Início: <strong class="text-slate-800 dark:text-slate-200 font-medium">${formatarData(c.data_aquisicao)}</strong></span>
                  </div>
                  ${!modoVisitante ? `
                    <button onclick="editarCaixa('${c.id}')" title="Editar Caixa" class="p-1.5 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-slate-100 dark:hover:bg-[#0c182b] transition flex-shrink-0 ml-2">
                      <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
                    </button>
                  ` : ''}
                </div>
              </div>
            </div>`;
        }

        if (modoVisualizacao === 'grid-2') {
          return `
            <div class="card-navy rounded-xl overflow-hidden flex flex-col justify-between">
              <div class="relative h-36 sm:h-44 overflow-hidden bg-slate-900 flex items-center justify-center group">
                <img id="caixa-card-img-${c.id}" data-idx="0" src="${fotoCapa}" alt="${c.nome}" class="w-full h-full object-cover cursor-pointer hover:scale-105 transition duration-300" onclick="abrirGaleriaCaixa('${c.id}')" onerror="this.src='https://placehold.co/800x500/0a1322/38bdf8?text=Sem+Foto'">
                <span class="absolute top-1.5 right-1.5 bg-black/80 backdrop-blur px-2 py-0.5 rounded-full text-[9px] font-bold text-amber-300 z-10">${c.capacidade} slots</span>
                ${fotosQtd > 1 ? `
                  <button onclick="mudarFotoCardCaixa('${c.id}', -1, event)" class="absolute left-1 top-1/2 -translate-y-1/2 bg-black/60 text-white p-1 rounded-full opacity-80 sm:opacity-0 sm:group-hover:opacity-100 transition z-20"><i data-lucide="chevron-left" class="w-3 h-3"></i></button>
                  <button onclick="mudarFotoCardCaixa('${c.id}', 1, event)" class="absolute right-1 top-1/2 -translate-y-1/2 bg-black/60 text-white p-1 rounded-full opacity-80 sm:opacity-0 sm:group-hover:opacity-100 transition z-20"><i data-lucide="chevron-right" class="w-3 h-3"></i></button>
                ` : ''}
              </div>
              <div class="p-2 sm:p-2.5 flex-1 flex flex-col justify-between">
                <div class="cursor-pointer group/title" onclick="abrirDetalhesCaixa('${c.id}')" title="Ver Detalhes">
                  <p class="text-[9px] uppercase tracking-wider text-amber-600 dark:text-amber-400 font-bold truncate group-hover/title:text-amber-300 transition">Caixa</p>
                  <h3 class="text-xs font-semibold text-slate-900 dark:text-white truncate group-hover/title:text-amber-400 transition">${c.nome}</h3>
                </div>
                <div class="mt-2 pt-1.5 border-t border-slate-200/80 dark:border-[#132238] flex items-center justify-between text-[9px] text-slate-400">
                  <span class="truncate">${formatarData(c.data_aquisicao)}</span>
                  ${!modoVisitante ? `
                    <button onclick="editarCaixa('${c.id}')" title="Editar" class="p-1 rounded text-slate-400 hover:text-amber-400 hover:bg-slate-100 dark:hover:bg-[#0c182b] transition flex-shrink-0">
                      <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
                    </button>
                  ` : ''}
                </div>
              </div>
            </div>`;
        }

        if (modoVisualizacao === 'grid-3') {
          return `
            <div class="card-navy rounded-lg overflow-hidden flex flex-col justify-between">
              <div class="relative h-24 sm:h-32 overflow-hidden bg-slate-900 cursor-pointer group" onclick="abrirGaleriaCaixa('${c.id}')" title="Ver Fotos">
                <img src="${fotoCapa}" alt="${c.nome}" class="w-full h-full object-cover group-hover:scale-105 transition duration-300" onerror="this.src='https://placehold.co/800x500/0a1322/38bdf8?text=Sem+Foto'">
                <span class="absolute top-1 right-1 bg-black/80 px-1.5 py-0.2 rounded text-[8px] font-bold text-amber-300">${c.capacidade}p</span>
              </div>
              <div class="p-1.5 flex flex-col justify-between">
                <div class="cursor-pointer group/title" onclick="abrirDetalhesCaixa('${c.id}')" title="Ver Detalhes">
                  <p class="text-[8px] uppercase tracking-tighter text-amber-500 font-bold truncate group-hover/title:text-amber-300 transition">Caixa</p>
                  <h4 class="text-[10px] font-semibold text-slate-900 dark:text-white truncate group-hover/title:text-amber-400 transition">${c.nome}</h4>
                </div>
                <div class="mt-1 flex items-center justify-between pt-1 border-t border-slate-200/80 dark:border-[#132238] text-[8px] text-slate-400">
                  <span class="truncate">${formatarData(c.data_aquisicao)}</span>
                  ${!modoVisitante ? `
                    <button onclick="editarCaixa('${c.id}')" title="Editar" class="text-slate-400 hover:text-amber-400 p-0.5 transition flex-shrink-0">
                      <i data-lucide="edit-3" class="w-3 h-3"></i>
                    </button>
                  ` : ''}
                </div>
              </div>
            </div>`;
        }

        if (modoVisualizacao === 'list') {
          return `
            <div class="card-navy rounded-xl p-2 sm:p-2.5 flex items-center justify-between gap-2.5">
              <div class="flex items-center gap-2.5 min-w-0">
                <img src="${fotoCapa}" alt="${c.nome}" class="w-14 h-14 sm:w-16 sm:h-16 rounded-lg object-cover bg-slate-900 flex-shrink-0 cursor-pointer hover:opacity-90 transition" onclick="abrirGaleriaCaixa('${c.id}')" title="Ver Fotos" onerror="this.src='https://placehold.co/800x500/0a1322/38bdf8?text=Sem+Foto'">
                <div class="min-w-0 cursor-pointer group/title" onclick="abrirDetalhesCaixa('${c.id}')" title="Ver Detalhes">
                  <div class="flex items-center gap-1.5">
                    <span class="text-[10px] uppercase tracking-wider text-amber-600 dark:text-amber-400 font-bold truncate group-hover/title:text-amber-300 transition">Estojo / Caixa</span>
                    <span class="bg-amber-500/20 text-amber-300 text-[8px] font-bold px-1.5 py-0.5 rounded border border-amber-500/30">${c.capacidade} Posições</span>
                  </div>
                  <h3 class="text-xs sm:text-sm font-semibold text-slate-900 dark:text-white truncate group-hover/title:text-amber-400 transition">${c.nome}</h3>
                  <div class="flex flex-wrap items-center gap-x-2 text-[10px] text-slate-400 mt-0.5">
                    <span>${formatarData(c.data_aquisicao)}</span>
                    ${c.status ? `<span class="text-slate-300 dark:text-slate-400">• ${c.status}</span>` : ''}
                    <span>• ${fotosQtd} foto(s)</span>
                  </div>
                </div>
              </div>
              <div class="flex items-center flex-shrink-0">
                ${!modoVisitante ? `
                  <button onclick="editarCaixa('${c.id}')" title="Editar" class="p-2 rounded-lg bg-slate-100 dark:bg-[#0b1626] border border-slate-200 dark:border-[#1b2f4d] text-slate-400 hover:text-amber-500 transition">
                    <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
                  </button>
                ` : ''}
              </div>
            </div>`;
        }
      }).join('');
      lucide.createIcons();
    }

    function carregarDashboardGeral() {
      const relogios = bancoDados.relogios, caixas = bancoDados.caixas;
      const isDark = document.documentElement.classList.contains('dark');
      const textColor = isDark ? '#94a3b8' : '#475569';
      const gridColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
      const borderColor = isDark ? '#0b1424' : '#ffffff';
      // Paleta Horológica Luxo (Menos saturada, tons champagne, safira, platina e esmeralda nobre)
      const luxPalette = ['#38bdf8', '#c5a059', '#34d399', '#818cf8', '#94a3b8', '#fb923c', '#a78bfa', '#64748b'];
      const totalPecas = relogios.length;
      const comprados = relogios.filter(r => r.tipo_aquisicao !== 'presente');
      const presentes = relogios.filter(r => r.tipo_aquisicao === 'presente');
      const valorTotalAcervo = relogios.reduce((acc, r) => acc + (parseFloat(r.valor) || 0), 0);
      const valorComprados = comprados.reduce((acc, r) => acc + (parseFloat(r.valor) || 0), 0);
      const valorPresentes = presentes.reduce((acc, r) => acc + (parseFloat(r.valor) || 0), 0);
      const precoMedioReal = comprados.length > 0 ? valorComprados / comprados.length : 0;
      const capacidadeTotal = caixas.reduce((acc, c) => acc + (parseInt(c.capacidade) || 0), 0);
      const ocupacaoPct = capacidadeTotal > 0 ? Math.round((totalPecas / capacidadeTotal) * 100) : 0;
      const slotsLivres = Math.max(0, capacidadeTotal - totalPecas);
      // Atualiza Cards Superiores
      document.getElementById('metric-valor-total-acervo').innerText = valorTotalAcervo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      document.getElementById('metric-total-relogios').innerText = `${totalPecas} peça(s) no acervo`;
      document.getElementById('metric-valor-comprados').innerText = valorComprados.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      document.getElementById('metric-count-comprados').innerText = `${comprados.length} peça(s) comprada(s)`;
      document.getElementById('metric-valor-presentes').innerText = valorPresentes.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      document.getElementById('metric-count-presentes').innerText = `${presentes.length} peça(s) ganha(s)`;
      document.getElementById('metric-preco-medio-real').innerText = precoMedioReal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      // Lógica de Ocupação das Caixas com Alerta Dinâmico
      const elOcupacao = document.getElementById('metric-ocupacao');
      const elVagasTexto = document.getElementById('metric-vagas-texto');
      const elSlotsLivres = document.getElementById('metric-slots-livres');
      const elOcupacaoBar = document.getElementById('metric-ocupacao-bar');
      elOcupacao.innerText = `${ocupacaoPct}%`;
      elVagasTexto.innerText = `${totalPecas} / ${capacidadeTotal} slots`;
      if (elOcupacaoBar) elOcupacaoBar.style.width = `${Math.min(ocupacaoPct, 100)}%`;
      if (ocupacaoPct >= 90) {
        elOcupacao.className = "text-lg sm:text-xl font-bold text-rose-500 animate-pulse";
        if (elOcupacaoBar) elOcupacaoBar.className = "h-full rounded-full transition-all duration-700 bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.6)]";
        if (elSlotsLivres) {
          elSlotsLivres.className = "block text-[10px] text-rose-500 font-semibold mt-1 truncate";
          elSlotsLivres.innerText = slotsLivres === 0 ? "Caixas lotadas! Nova caixa recomendada." : `${slotsLivres} slot(s) livre(s) — Atenção: quase cheia!`;
        }
      } else {
        elOcupacao.className = "text-lg sm:text-xl font-bold text-sky-600 dark:text-sky-300";
        if (elOcupacaoBar) elOcupacaoBar.className = "h-full rounded-full transition-all duration-700 bg-sky-500";
        if (elSlotsLivres) {
          elSlotsLivres.className = "block text-[10px] text-slate-400 mt-1 truncate";
          elSlotsLivres.innerText = `${slotsLivres} slot(s) livre(s)`;
        }
      }

      // Plugin Reutilizável de Totalizador Central para Gráficos Doughnut
      const centerCutoutPlugin = {
        id: 'centerCutoutMetric',
        beforeDraw(chart) {
          if (chart.config.type !== 'doughnut') return;
          const config = chart.config.options?.plugins?.centerCutoutMetric;
          if (!config || config.total === undefined) return;
          const { ctx, chartArea } = chart;
          if (!chartArea) return;
          const centerX = (chartArea.left + chartArea.right) / 2;
          const centerY = (chartArea.top + chartArea.bottom) / 2;
          ctx.save();
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = 'bold 20px Cinzel, Inter, sans-serif';
          ctx.fillStyle = isDark ? '#f8fafc' : '#0f172a';
          ctx.fillText(String(config.total), centerX, centerY - 6);
          ctx.font = '600 8.5px Inter, sans-serif';
          ctx.fillStyle = isDark ? '#64748b' : '#94a3b8';
          ctx.fillText((config.sublabel || '').toUpperCase(), centerX, centerY + 12);
          ctx.restore();
        }
      };

      // 1. Gráfico de Marcas
      const contagemMarcas = {};
      relogios.forEach(r => { const m = (r.marca || 'Outros').toUpperCase(); contagemMarcas[m] = (contagemMarcas[m] || 0) + 1; });
      const totalMarcasDistintas = Object.keys(contagemMarcas).length;
        if (chartMarcasInst) chartMarcasInst.destroy();
          const ctxMarcas = document.getElementById('chartMarcas').getContext('2d');
          chartMarcasInst = new Chart(ctxMarcas, {
          type: 'doughnut',
          data: {
            labels: Object.keys(contagemMarcas),
            datasets: [{
            data: Object.values(contagemMarcas),
            backgroundColor: luxPalette,
            borderColor: borderColor,
            borderWidth: 2,
            hoverOffset: 5
          }]
        },
        plugins: [centerCutoutPlugin],
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '74%',
          plugins: {
            centerCutoutMetric: { total: totalMarcasDistintas, sublabel: 'Marcas' },
            legend: {
              position: 'bottom',
              labels: { color: textColor, boxWidth: 7, boxHeight: 7, usePointStyle: true, pointStyle: 'circle', font: { size: 10, family: 'Inter' }, padding: 10 }
            }
          }
        }
      });

      // 2. Gráfico de Estilos e Categorias
      const contagemTipos = {};
      relogios.forEach(r => { const t = r.tipo ? r.tipo.trim() : 'Geral'; contagemTipos[t] = (contagemTipos[t] || 0) + 1; });
      const totalEstilos = Object.keys(contagemTipos).length;
        if (chartTiposInst) chartTiposInst.destroy();
      const ctxTipos = document.getElementById('chartTipos').getContext('2d');
      chartTiposInst = new Chart(ctxTipos, {
        type: 'doughnut',
        data: {
          labels: Object.keys(contagemTipos),
          datasets: [{
            data: Object.values(contagemTipos),
            backgroundColor: ['#c5a059', '#38bdf8', '#34d399', '#a78bfa', '#94a3b8', '#fb923c'],
            borderColor: borderColor,
            borderWidth: 2,
            hoverOffset: 5
          }]
        },
        plugins: [centerCutoutPlugin],
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '74%',
          plugins: {
            centerCutoutMetric: { total: totalEstilos, sublabel: 'Estilos' },
            legend: {
              position: 'bottom',
              labels: { color: textColor, boxWidth: 7, boxHeight: 7, usePointStyle: true, pointStyle: 'circle', font: { size: 10, family: 'Inter' }, padding: 10 }
            }
          }
        }
      });

      // 3. Gráfico de Mecanismos / Calibres
      const contagemMovimentos = { 'Automático': 0, 'Quartzo': 0, 'Manual': 0, 'Outros': 0 };
      relogios.forEach(r => {
        const cal = (r.calibre || '').toLowerCase();
        if (cal.includes('autom') || cal.includes('nh34') || cal.includes('nh35') || cal.includes('miyota')) contagemMovimentos['Automático']++;
        else if (cal.includes('quart') || cal.includes('bateria')) contagemMovimentos['Quartzo']++;
        else if (cal.includes('manual') || cal.includes('corda')) contagemMovimentos['Manual']++;
        else contagemMovimentos['Outros']++;
      });
      Object.keys(contagemMovimentos).forEach(k => { if (contagemMovimentos[k] === 0) delete contagemMovimentos[k]; });
      if (chartMovimentosInst) chartMovimentosInst.destroy();
      const ctxMovimentos = document.getElementById('chartMovimentos').getContext('2d');
      chartMovimentosInst = new Chart(ctxMovimentos, {
        type: 'doughnut',
        data: {
          labels: Object.keys(contagemMovimentos),
          datasets: [{
            data: Object.values(contagemMovimentos),
            backgroundColor: ['#34d399', '#38bdf8', '#c5a059', '#94a3b8'],
            borderColor: borderColor,
            borderWidth: 2,
            hoverOffset: 5
          }]
        },
        plugins: [centerCutoutPlugin],
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '74%',
          plugins: {
            centerCutoutMetric: { total: totalPecas, sublabel: 'Calibres' },
            legend: {
              position: 'bottom',
              labels: { color: textColor, boxWidth: 7, boxHeight: 7, usePointStyle: true, pointStyle: 'circle', font: { size: 10, family: 'Inter' }, padding: 10 }
            }
          }
        }
      });

      // 4. Gráfico Maiores Valores
      const pecasOrdenadasValor = [...relogios].filter(r => (parseFloat(r.valor) || 0) > 0).sort((a, b) => (b.valor || 0) - (a.valor || 0)).slice(0, 7);
      const coresValores = pecasOrdenadasValor.map(r => r.tipo_aquisicao === 'presente' ? 'rgba(197, 160, 89, 0.85)' : 'rgba(56, 189, 248, 0.85)');
      const bordasValores = pecasOrdenadasValor.map(r => r.tipo_aquisicao === 'presente' ? '#c5a059' : '#38bdf8');
        if (chartValoresInst) chartValoresInst.destroy();
          const ctxValores = document.getElementById('chartValores').getContext('2d');
          chartValoresInst = new Chart(ctxValores, {
          type: 'bar',
          data: {
          labels: pecasOrdenadasValor.map(r => `${r.marca} ${r.modelo}`.substring(0, 14)),
          datasets: [{
            label: 'Valor (R$)',
            data: pecasOrdenadasValor.map(r => r.valor),
            backgroundColor: coresValores,
            borderColor: bordasValores,
            borderWidth: 1,
            borderRadius: { topLeft: 5, topRight: 5 },
            barPercentage: 0.5
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: { grid: { color: gridColor, drawBorder: false }, ticks: { color: textColor, font: { size: 9 }, callback: val => `R$ ${val}` } },
            x: { grid: { display: false, drawBorder: false }, ticks: { color: textColor, font: { size: 9 } } }
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: isDark ? 'rgba(11,20,36,0.95)' : 'rgba(255,255,255,0.95)',
              titleColor: isDark ? '#ffffff' : '#0f172a',
              bodyColor: isDark ? '#38bdf8' : '#0284c7',
              borderColor: isDark ? '#1e3860' : '#cbd5e1',
              borderWidth: 1,
              padding: 10,
              callbacks: {
                label: (context) => {
                  const r = pecasOrdenadasValor[context.dataIndex];
                  const tipo = (r && r.tipo_aquisicao === 'presente') ? 'Presente' : 'Compra';
                  return ` ${tipo}: R$ ${context.parsed.y.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
                }
              }
            }
          }
        }
      });
  // 5. Salva em cache e renderiza Linha do Tempo (com suporte a Mês / Ano)
      cacheRelogiosDashboard = relogios;
      renderizarGraficoTimeline();
      lucide.createIcons();    }

  // LÓGICA DE GALERIA ESTILO CELULAR (FLUXO GLOBAL)
    let filtroGaleriaTipo = 'todos';
    let midiasGaleriaModal = [];
    let indiceGaleriaModal = 0;
    let zoomAtivoManual = false;
    let galeriaGridSize = localStorage.getItem('mywatches_galeria_grid') || 'md';
    let lastTapTempo = 0;

  // Alterna entre Mês e Ano nas pills
    function mudarModoTimeline(modo) {
    modoTimelineAtual = modo;
    const btnMes = document.getElementById('btnTimelineMes');
    const btnAno = document.getElementById('btnTimelineAno');
      if (modo === 'mes') {
        btnMes.className = 'px-2.5 py-0.5 text-xs font-semibold rounded bg-cyan-500/20 text-cyan-400 border border-cyan-500/40 transition-colors';
        btnAno.className = 'px-2.5 py-0.5 text-xs font-semibold rounded text-slate-400 hover:text-white border border-transparent transition-colors';
    } else {
        btnAno.className = 'px-2.5 py-0.5 text-xs font-semibold rounded bg-cyan-500/20 text-cyan-400 border border-cyan-500/40 transition-colors';
        btnMes.className = 'px-2.5 py-0.5 text-xs font-semibold rounded text-slate-400 hover:text-white border border-transparent transition-colors';
    }
    renderizarGraficoTimeline();
}

// Renderiza o gráfico conforme o modo ativo
    function renderizarGraficoTimeline() {
    const ctxTimeline = document.getElementById('chartTimeline')?.getContext('2d');
    if (!ctxTimeline) return;
    const mesesNomes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const contagem = {};
    cacheRelogiosDashboard.forEach(r => {
        if (!r.data_compra) return;
        const partes = r.data_compra.split('-'); // Esperado: YYYY-MM-DD
        const ano = partes[0];
        const mesIdx = parseInt(partes[1], 10) - 1;
        if (!ano) return;
        if (modoTimelineAtual === 'mes') {
            const chave = `${ano}-${partes[1]}`;
            const label = `${mesesNomes[mesIdx] || partes[1]}/${ano.slice(2)}`;
            if (!contagem[chave]) contagem[chave] = { label, total: 0 };
            contagem[chave].total += 1;
        } else {
            if (!contagem[ano]) contagem[ano] = { label: ano, total: 0 };
            contagem[ano].total += 1;
        }
    });
    const chavesOrdenadas = Object.keys(contagem).sort();
    const labels = chavesOrdenadas.map(c => contagem[c].label);
    const dados = chavesOrdenadas.map(c => contagem[c].total);
    if (chartTimelineInst) chartTimelineInst.destroy();
    chartTimelineInst = new Chart(ctxTimeline, {
        type: 'bar',
        data: {
            labels: labels.length ? labels : ['Sem dados'],
            datasets: [{
                label: 'Relógios Adquiridos',
                data: dados.length ? dados : [0],
                backgroundColor: 'rgba(56, 189, 248, 0.25)',
                borderColor: '#38bdf8',
                borderWidth: 1.5,
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { precision: 0, color: '#94a3b8' },
                    grid: { color: 'rgba(255, 255, 255, 0.05)' }
                },
                x: {
                    ticks: { color: '#94a3b8' },
                    grid: { display: false }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => ` ${ctx.raw} ${ctx.raw === 1 ? 'peça adquirida' : 'peças adquiridas'}`
                    }
                }
            }
        }
    });
}

    function definirFiltroGaleriaTipo(tipo) {
      filtroGaleriaTipo = tipo;
      atualizarBotoesFiltroGaleria();
      renderizarGaleria();
    }

    function atualizarBotoesFiltroGaleria() {
      const botoes = [
        { id: 'todos', el: document.getElementById('pill-gal-todos') },
        { id: 'fotos', el: document.getElementById('pill-gal-fotos') },
        { id: 'videos', el: document.getElementById('pill-gal-videos') }
      ];
      botoes.forEach(b => {
        if (!b.el) return;
        if (b.id === filtroGaleriaTipo) {
          b.el.className = "inline-flex items-center gap-1 px-2.5 py-1 rounded-full whitespace-nowrap transition bg-sky-500 text-slate-950 font-semibold shadow-sm";
        } else {
          b.el.className = "inline-flex items-center gap-1 px-2.5 py-1 rounded-full whitespace-nowrap transition border border-slate-200 dark:border-[#1b2f4d] bg-white dark:bg-[#070e1a] text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white";
        }
      });
    }

    function definirTamanhoGaleria(tamanho) {
      galeriaGridSize = tamanho;
      localStorage.setItem('mywatches_galeria_grid', tamanho);
      renderizarGaleria();
    }

    function obterMidiasGaleriaFiltradas() {
      const midias = [];
      (bancoDados.relogios || []).forEach(r => {
        if (filtroGaleriaTipo !== 'videos' && r.fotos) {
          r.fotos.forEach((url, fIdx) => {
            midias.push({
              tipo: 'foto',
              url: url,
              marca: r.marca,
              modelo: r.modelo,
              relogioId: r.id,
              isCapa: fIdx === 0
            });
          });
        }
        if (filtroGaleriaTipo !== 'fotos' && r.video) {
          midias.push({
            tipo: 'video',
            url: r.video,
            marca: r.marca,
            modelo: r.modelo,
            relogioId: r.id,
            isCapa: false
          });
        }
      });
      return midias;
    }

    function abrirGaleriaRelogio(id, urlFotoEspecifica = null) {
      const r = bancoDados.relogios.find(item => item.id === id);
      if (!r || ((!r.fotos || r.fotos.length === 0) && !r.video)) {
        return alert("Nenhuma foto ou vídeo disponível para esta peça.");
      }
      const lista = [];
      if (r.fotos) {
        r.fotos.forEach((url, fIdx) => {
          lista.push({ tipo: 'foto', url: url, marca: r.marca, modelo: r.modelo, relogioId: r.id, isCapa: fIdx === 0 });
        });
      }
      if (r.video) {
        lista.push({ tipo: 'video', url: r.video, marca: r.marca, modelo: r.modelo, relogioId: r.id, isCapa: false });
      }
      let idxInicial = 0;
      if (urlFotoEspecifica) {
        const achou = lista.findIndex(m => m.url === urlFotoEspecifica);
        if (achou !== -1) idxInicial = achou;
      }
      iniciarVisualizadorMidas(lista, idxInicial);
    }

    function abrirGaleriaCaixa(id) {
      const c = bancoDados.caixas.find(item => item.id === id);
      if (!c || !c.fotos || c.fotos.length === 0) return alert("Nenhuma foto cadastrada.");
      const lista = c.fotos.map(url => ({
        tipo: 'foto',
        url: url,
        marca: 'Evolução da Caixa',
        modelo: c.nome,
        relogioId: null
      }));
      iniciarVisualizadorMidas(lista, 0);
    }

    function iniciarVisualizadorMidas(listaMidias, indexInicial = 0) {
      if (!listaMidias || listaMidias.length === 0) return;
      midiasGaleriaModal = listaMidias;
      indiceGaleriaModal = Math.max(0, Math.min(indexInicial, midiasGaleriaModal.length - 1));
      zoomAtivoManual = false;
      atualizarConteudoVisualizador();
      abrirModalSuave('modal-galeria');
      lucide.createIcons();
    }

    function atualizarConteudoVisualizador() {
      if (midiasGaleriaModal.length === 0) return;
      desativarZoom();
      const item = midiasGaleriaModal[indiceGaleriaModal];
      const imgZoom = document.getElementById('galeria-img-zoom');
      const vidPlayer = document.getElementById('galeria-video-player');
      const btnFicha = document.getElementById('galeria-btn-ficha-rapida');
      document.getElementById('galeria-marca').innerText = item.marca || 'Coleção';
      document.getElementById('galeria-modelo').innerText = item.modelo || '';
      if (btnFicha) {
        btnFicha.classList.toggle('hidden', !item.relogioId);
      }
      if (item.tipo === 'video') {
        imgZoom.classList.add('hidden');
        imgZoom.src = '';
        vidPlayer.classList.remove('hidden');
        vidPlayer.src = item.url;
        vidPlayer.play().catch(() => {});
      } else {
        if (vidPlayer) {
          vidPlayer.pause();
          vidPlayer.classList.add('hidden');
          vidPlayer.src = '';
        }
        imgZoom.classList.remove('hidden');
        imgZoom.src = item.url;
      }
      document.getElementById('galeria-contador-fotos').innerText = `${indiceGaleriaModal + 1}/${midiasGaleriaModal.length}`;
      const thumbs = document.getElementById('galeria-thumbs');
      if (thumbs) {
        thumbs.innerHTML = midiasGaleriaModal.map((m, i) => `
          <div onclick="pularParaMidiaGaleria(${i})" class="relative flex-shrink-0 cursor-pointer rounded-lg overflow-hidden border-2 ${i === indiceGaleriaModal ? 'border-sky-500 ring-2 ring-sky-500/40' : 'border-slate-800 opacity-60 hover:opacity-100'} w-12 h-12 bg-black">
            ${m.tipo === 'video' ? `
              <video src="${m.url}" class="w-full h-full object-cover"></video>
              <div class="absolute inset-0 flex items-center justify-center bg-black/40"><i data-lucide="play" class="w-3.5 h-3.5 text-white"></i></div>
            ` : `
              <img src="${m.url}" class="w-full h-full object-cover">
            `}
          </div>
        `).join('');
        const activeThumb = thumbs.children[indiceGaleriaModal];
        if (activeThumb) activeThumb.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
      lucide.createIcons();
    }

    function pularParaMidiaGaleria(idx) {
      indiceGaleriaModal = idx;
      atualizarConteudoVisualizador();
    }

    function navegarFotoGaleria(direcao, event = null) {
      if (event) event.stopPropagation();
      if (midiasGaleriaModal.length <= 1) return;
      indiceGaleriaModal += direcao;
      if (indiceGaleriaModal < 0) indiceGaleriaModal = midiasGaleriaModal.length - 1;
      if (indiceGaleriaModal >= midiasGaleriaModal.length) indiceGaleriaModal = 0;
      atualizarConteudoVisualizador();
    }

    function abrirFichaDaMidiaAtual() {
      const item = midiasGaleriaModal[indiceGaleriaModal];
      if (!item || !item.relogioId) return;
      fecharModalGaleria();
      abrirDetalhes(item.relogioId);
    }

    function aplicarTransformZoom(scale, originX = '50%', originY = '50%') {
      zoomNivel = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, scale));
      const img = document.getElementById('galeria-img-zoom');
      if (!img) return;
      if (zoomNivel <= 1.02) {
        zoomNivel = 1;
        img.style.transform = 'scale(1)';
        img.style.transformOrigin = 'center center';
      } else {
        img.style.transformOrigin = `${originX} ${originY}`;
        img.style.transform = `scale(${zoomNivel.toFixed(2)})`;
      }
    }

    function desativarZoom() {
      aplicarTransformZoom(1);
    }

    function fecharModalGaleria() {
      const vidPlayer = document.getElementById('galeria-video-player');
      if (vidPlayer) {
        vidPlayer.pause();
        vidPlayer.currentTime = 0;
      }
      desativarZoom();
      fecharModalSuave('modal-galeria');
    }

    // Renderiza o grid da aba Galeria
    function renderizarGaleria() {
      const grid = document.getElementById('grid-galeria');
      if (!grid) return;
      grid.innerHTML = '';
      ['sm', 'md', 'lg'].forEach(size => {
        const b = document.getElementById(`btn-gal-${size}`);
        if (!b) return;
        b.className = (size === galeriaGridSize)
          ? "px-2 py-1 text-[11px] rounded transition font-bold bg-sky-500 text-slate-950 shadow-sm"
          : "px-2 py-1 text-[11px] rounded transition font-medium text-slate-500 dark:text-slate-400 hover:text-sky-500";
      });

      if (galeriaGridSize === 'sm') {
        grid.className = "grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-1.5 sm:gap-2";
      } else if (galeriaGridSize === 'lg') {
        grid.className = "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4";
      } else {
        grid.className = "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5 sm:gap-3";
      }
      let totalFotos = 0;
      let totalVideos = 0;
      (bancoDados.relogios || []).forEach(r => {
        if (r.fotos) totalFotos += r.fotos.length;
        if (r.video) totalVideos += 1;
      });
      const badgeTodos = document.getElementById('badge-gal-todos');
      const badgeFotos = document.getElementById('badge-gal-fotos');
      const badgeVideos = document.getElementById('badge-gal-videos');
        if (badgeTodos) badgeTodos.innerText = `(${totalFotos + totalVideos})`;
        if (badgeFotos) badgeFotos.innerText = `(${totalFotos})`;
        if (badgeVideos) badgeVideos.innerText = `(${totalVideos})`;
      const midias = obterMidiasGaleriaFiltradas();
      document.getElementById('galeria-contador').innerText = `${midias.length} mídias`;
        if (midias.length === 0) {
        grid.innerHTML = `<div class="col-span-full py-16 text-center text-slate-500 text-xs">Nenhuma mídia encontrada com o filtro selecionado.</div>`;
        return;
      }
      grid.innerHTML = midias.map((m, idx) => {
        if (m.tipo === 'foto') {
          return `
            <div class="card-navy rounded-xl overflow-hidden aspect-square relative group cursor-pointer" onclick="iniciarVisualizadorMidas(obterMidiasGaleriaFiltradas(), ${idx})">
              <img src="${m.url}" class="w-full h-full object-cover group-hover:scale-105 transition duration-300">
              <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-2">
                <p class="text-[10px] text-white font-medium truncate">${m.marca} ${m.modelo}</p>
                <span class="text-[8px] text-sky-400 font-semibold uppercase">Foto</span>
              </div>
            </div>`;
        } else {
          return `
            <div class="card-navy rounded-xl overflow-hidden aspect-square relative group cursor-pointer bg-black" onclick="iniciarVisualizadorMidas(obterMidiasGaleriaFiltradas(), ${idx})">
              <video src="${m.url}" class="w-full h-full object-cover opacity-75"></video>
              <div class="absolute inset-0 flex items-center justify-center">
                <i data-lucide="play-circle" class="w-9 h-9 text-white/90 group-hover:scale-110 transition drop-shadow-lg"></i>
              </div>
              <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent p-2">
                <p class="text-[10px] text-white font-medium truncate">${m.marca} ${m.modelo}</p>
                <span class="text-[8px] text-purple-400 font-semibold uppercase">Vídeo</span>
              </div>
            </div>`;
        }
      }).join('');
      lucide.createIcons();
    }
  // CONTROLES DE ZOOM: PINCH, SCROLL E DOUBLE-TAP
    let zoomNivel = 1;
    const ZOOM_MIN = 1;
    const ZOOM_MAX = 4.5;
    let pinchDistInicial = 0;
    let pinchZoomInicial = 1;
    const touchArea = document.getElementById('touch-area-galeria');
    let touchStartX = 0;
    let touchStartY = 0;
      if (touchArea) {
      // 1. Zoom com Scroll do Mouse (Web/Desktop)
      touchArea.addEventListener('wheel', (e) => {
        const item = midiasGaleriaModal[indiceGaleriaModal];
        if (!item || item.tipo === 'video') return;
        e.preventDefault();
        const rect = touchArea.getBoundingClientRect();
        const originX = `${((e.clientX - rect.left) / rect.width) * 100}%`;
        const originY = `${((e.clientY - rect.top) / rect.height) * 100}%`;
        const delta = e.deltaY < 0 ? 0.35 : -0.35;
        aplicarTransformZoom(zoomNivel + delta, originX, originY);
      }, { passive: false });

      // 2. Duplo clique (Desktop)
      touchArea.addEventListener('dblclick', (e) => {
        const item = midiasGaleriaModal[indiceGaleriaModal];
        if (!item || item.tipo === 'video') return;
        const rect = touchArea.getBoundingClientRect();
        const originX = `${((e.clientX - rect.left) / rect.width) * 100}%`;
        const originY = `${((e.clientY - rect.top) / rect.height) * 100}%`;
        if (zoomNivel > 1.2) desativarZoom();
        else aplicarTransformZoom(2.5, originX, originY);
      });

      // 3. Panning ao mover o mouse com zoom ativo
      touchArea.addEventListener('mousemove', (e) => {
        if (zoomNivel <= 1) return;
        const rect = touchArea.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;
        const img = document.getElementById('galeria-img-zoom');
        if (img) img.style.transformOrigin = `${x}% ${y}%`;
      });

      // 4. TouchStart: Detecta 1 dedo (swipe/tap) ou 2 dedos (pinça)
      touchArea.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
          const t1 = e.touches[0];
          const t2 = e.touches[1];
          pinchDistInicial = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
          pinchZoomInicial = zoomNivel;
        } else if (e.touches.length === 1) {
          touchStartX = e.touches[0].clientX;
          touchStartY = e.touches[0].clientY;
        }
      }, { passive: true });

      // 5. TouchMove: Executa o gesto de pinça
      touchArea.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2) {
          e.preventDefault();
          const t1 = e.touches[0];
          const t2 = e.touches[1];
          const distAtual = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
          if (pinchDistInicial > 0) {
            const ratio = distAtual / pinchDistInicial;
            const centroX = (t1.clientX + t2.clientX) / 2;
            const centroY = (t1.clientY + t2.clientY) / 2;
            const rect = touchArea.getBoundingClientRect();
            const originX = `${Math.max(0, Math.min(100, ((centroX - rect.left) / rect.width) * 100))}%`;
            const originY = `${Math.max(0, Math.min(100, ((centroY - rect.top) / rect.height) * 100))}%`;
            aplicarTransformZoom(pinchZoomInicial * ratio, originX, originY);
          }
        }
      }, { passive: false });

      // 6. TouchEnd: Double-tap para zoom e Swipe para troca de foto
      touchArea.addEventListener('touchend', (e) => {
        if (e.target && e.target.tagName && e.target.tagName.toLowerCase() === 'video') return;
        const agora = Date.now();
        const diffTempo = agora - lastTapTempo;
        const item = midiasGaleriaModal[indiceGaleriaModal];
        if (e.changedTouches.length === 1 && e.touches.length === 0) {
          const diffX = e.changedTouches[0].clientX - touchStartX;
          const diffY = e.changedTouches[0].clientY - touchStartY;
          // Se não estiver com zoom, executa swipe lateral
          if (zoomNivel <= 1.05 && Math.abs(diffX) > 40 && Math.abs(diffX) > Math.abs(diffY)) {
            if (diffX < 0) navegarFotoGaleria(1);
            else navegarFotoGaleria(-1);
          } 
          // Toque duplo no mobile
          else if (Math.abs(diffX) < 15 && Math.abs(diffY) < 15) {
            if (diffTempo < 300 && diffTempo > 0 && item && item.tipo !== 'video') {
              const rect = touchArea.getBoundingClientRect();
              const touch = e.changedTouches[0];
              const originX = `${((touch.clientX - rect.left) / rect.width) * 100}%`;
              const originY = `${((touch.clientY - rect.top) / rect.height) * 100}%`;
              if (zoomNivel > 1.2) desativarZoom();
              else aplicarTransformZoom(2.5, originX, originY);
            }
          }
        }
        lastTapTempo = agora;
      });
    }

    window.addEventListener('keydown', (e) => {
      const modalGaleria = document.getElementById('modal-galeria');
      if (modalGaleria && !modalGaleria.classList.contains('modal-closed')) {
        if (e.key === 'ArrowRight') navegarFotoGaleria(1);
        else if (e.key === 'ArrowLeft') navegarFotoGaleria(-1);
        else if (e.key === 'Escape') fecharModalGaleria();
      }
    });

    function abrirDetalhes(id) {
      const r = bancoDados.relogios.find(item => item.id === id);
      if (!r) return;
      const isPresente = r.tipo_aquisicao === 'presente';
      const p = Math.max(1, Math.min(5, parseInt(r.prestigio) || 5));
      const a = Math.max(1, Math.min(5, parseInt(r.afeto) || 5));
      const v = Math.max(1, Math.min(5, parseInt(r.valor_rating) || 5));
      document.getElementById('detalhe-marca').innerText = r.marca;
      document.getElementById('detalhe-modelo').innerText = r.modelo;
      document.getElementById('detalhe-foto').src = r.fotos[0] || '';
      document.getElementById('btn-ver-todas-fotos').onclick = () => { fecharModalDetalhes(); abrirGaleriaRelogio(r.id); };
      const grid = document.getElementById('detalhes-grid');
      const valorLabel = isPresente ? 'Valor Atribuído' : 'Valor Investido';
      const origemLabel = isPresente ? 'Presente de' : 'Origem';
      const campos = [
        { label: 'Tipo de Aquisição', valor: isPresente ? '🎁 Presente Ganho' : '🛒 Compra Pessoal', destaqueTipo: true },
        { label: 'Classificação', valor: `★ ${p} · ♥ ${a} · $ ${v}`, destaque: true },
        { label: 'Tipo', valor: r.tipo },
        { label: 'Maquinário / Calibre', valor: r.calibre, destaque: true },
        { label: 'Cor do Mostrador', valor: r.cor_mostrador },
        { label: 'Diâmetro da Caixa', valor: r.diametro },
        { label: 'Cor da Caixa', valor: r.cor_caixa },
        { label: 'Cor do Bisel', valor: r.cor_bisel },
        { label: 'Material da Correia', valor: r.material_correia },
        { label: 'Tipo da Correia', valor: r.tipo_correia },
        { label: 'Cor da Correia', valor: r.cor_correia },
        { label: 'Tipo de Fecho', valor: r.tipo_fecho },
        { label: origemLabel, valor: r.origem },
        { label: 'Entrou para a coleção em', valor: formatarData(r.data_compra) },
        (!modoVisitante && r.valor) ? { label: valorLabel, valor: r.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }), destaqueVerde: true } : null
      ];

      grid.innerHTML = campos.filter(c => c && c.valor && c.valor.toString().trim() !== '').map(c => {
        let cor = 'text-slate-800 dark:text-slate-100';
        if (c.destaque) cor = 'text-sky-600 dark:text-sky-400 font-semibold';
        else if (c.destaqueVerde) cor = 'text-emerald-600 dark:text-emerald-400 font-semibold';
        else if (c.destaqueTipo) cor = c.valor.includes('Presente') ? 'text-rose-500 dark:text-rose-400 font-semibold' : 'text-sky-600 dark:text-sky-400 font-semibold';
        return `<div class="flex justify-between py-1 border-b border-slate-200 dark:border-[#14233a]"><span class="text-slate-500 dark:text-slate-400">${c.label}:</span><span class="${cor}">${c.valor}</span></div>`;
      }).join('') || '<p class="text-slate-500">Nenhum detalhe especificado.</p>';

      const boxDesc = document.getElementById('detalhe-box-descricao');
      if (r.descricao && r.descricao.trim()) { 
        document.getElementById('detalhe-descricao').innerText = r.descricao; 
        boxDesc.classList.remove('hidden'); 
      } else {
        boxDesc.classList.add('hidden');
      }

      const boxHist = document.getElementById('detalhe-box-historia');
      if (r.historia && r.historia.trim()) { 
        document.getElementById('detalhe-historia').innerText = r.historia; 
        boxHist.classList.remove('hidden'); 
      } else {
        boxHist.classList.add('hidden');
      }

      const boxVid = document.getElementById('detalhe-box-video');
      const playerVid = document.getElementById('detalhe-video-player');
      if (r.video && boxVid && playerVid) {
        playerVid.src = r.video;
        boxVid.classList.remove('hidden');
      } else if (boxVid) {
        boxVid.classList.add('hidden');
        if (playerVid) playerVid.src = '';
      }
      abrirModalSuave('modal-detalhes');
      lucide.createIcons();
    }

    function fecharModalDetalhes() {
      const player = document.getElementById('detalhe-video-player');
      if (player) { player.pause(); player.currentTime = 0; }
      fecharModalSuave('modal-detalhes');
    }
    async function processarArquivoParaBase64(file) {
  let arquivoFinal = file;

  // Se for HEIC ou HEIF (fotos de iPhone)
  const isHeic = file.name.toLowerCase().endsWith('.heic') || 
                 file.name.toLowerCase().endsWith('.heif') || 
                 file.type.toLowerCase().includes('heic') || 
                 file.type.toLowerCase().includes('heif');

  if (isHeic && typeof heic2any !== 'undefined') {
    try {
      const blobJpg = await heic2any({
        blob: file,
        toType: 'image/jpeg',
        quality: 0.85
      });
      // Converte o retorno em File (caso retorne array de blobs ou blob único)
      const blobReal = Array.isArray(blobJpg) ? blobJpg[0] : blobJpg;
      const novoNome = file.name.replace(/\.(heic|heif)$/i, '.jpg');
      arquivoFinal = new File([blobReal], novoNome, { type: 'image/jpeg' });
    } catch (e) {
      console.warn('Falha ao converter HEIC com heic2any:', e);
    }
  }

  // Prossegue para a compressão ou FileReader existente
  return await comprimirImagem(arquivoFinal);
}

async function converterHeicSeNecessario(file) {
  const isHeic = file.name.toLowerCase().endsWith('.heic') || 
                 file.name.toLowerCase().endsWith('.heif') || 
                 file.type.toLowerCase().includes('heic') || 
                 file.type.toLowerCase().includes('heif');

  if (isHeic && typeof heic2any !== 'undefined') {
    try {
      const resultado = await heic2any({
        blob: file,
        toType: 'image/jpeg',
        quality: 0.85
      });
      const blob = Array.isArray(resultado) ? resultado[0] : resultado;
      return new File([blob], file.name.replace(/\.(heic|heif)$/i, '.jpg'), { type: 'image/jpeg' });
    } catch (e) {
      console.warn("Falha na conversão HEIC:", e);
      return file;
    }
  }
  return file;
}

    async function processarArquivoFoto(file) {
  // Verifica se é HEIC (pela extensão ou mime type)
  const isHeic = file.name.toLowerCase().endsWith('.heic') || 
                 file.name.toLowerCase().endsWith('.heif') || 
                 file.type === 'image/heic' || 
                 file.type === 'image/heif';

  let arquivoParaComprimir = file;

  if (isHeic) {
    try {
      // Converte HEIC para Blob JPEG
      const blobJpg = await heic2any({
        blob: file,
        toType: 'image/jpeg',
        quality: 0.9
      });

      // Cria um File válido a partir do blob convertido
      const novoNome = file.name.replace(/\.(heic|heif)$/i, '.jpg');
      arquivoParaComprimir = new File([blobJpg], novoNome, { type: 'image/jpeg' });
    } catch (err) {
      console.error('Erro ao converter HEIC:', err);
      alert('Não foi possível processar a foto HEIC. Tente tirar a foto em JPEG ou converter antes.');
      return null;
    }
  }

  // Agora envia para a sua função existente
  return await comprimirImagem(arquivoParaComprimir);
}

    function comprimirImagem(file, maxDimensao = 1200, qualidade = 0.82) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const img = new Image();
          img.onload = () => {
            let { width, height } = img;
            if (width > maxDimensao || height > maxDimensao) {
              if (width > height) { height = Math.round(height * (maxDimensao / width)); width = maxDimensao; }
              else { width = Math.round(width * (maxDimensao / height)); height = maxDimensao; }
            }
            const canvas = document.createElement('canvas');
            canvas.width = width; canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            const dataUrl = canvas.toDataURL('image/jpeg', qualidade);
            resolve(dataUrl);
          };
          img.onerror = reject;
          img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    function atualizarStatusRede() {
      const badge = document.getElementById('net-status-badge');
      const btnSync = document.getElementById('btn-sync-all');
      if (!navigator.onLine) {
        badge.classList.remove('hidden');
        badge.classList.add('flex');
        if (btnSync) btnSync.classList.add('opacity-50', 'pointer-events-none');
      } else {
        badge.classList.add('hidden');
        badge.classList.remove('flex');
        if (btnSync) btnSync.classList.remove('opacity-50', 'pointer-events-none');
      }
    }
    window.addEventListener('online', atualizarStatusRede);
    window.addEventListener('offline', atualizarStatusRede);

    function dataUrlToBlob(dataUrl) {
      const [header, base64] = dataUrl.split(',');
      const mime = header.match(/:(.*?);/)[1];
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new Blob([bytes], { type: mime });
    }

async function chamarGemini(referencia, prompt) {
  // Use o modelo mais recente suportado (ex: gemini-2.5-flash)
  const MODELO = 'gemini-3.5-flash-lite';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': CONFIG.geminiKey
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: prompt }]
        }
      ]
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `Erro HTTP ${response.status}`);
  }

  const data = await response.json();
  return data.candidates[0].content.parts[0].text;
}

    async function chamarGroq(referencia, prompt) {
      if (!CONFIG.groqKey) throw new Error("Chave da Groq não configurada.");
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CONFIG.groqKey}`
        },
        body: JSON.stringify({
          model: 'openai/gpt-oss-120b',
          temperature: 0.2,
          max_tokens: 1000,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: 'Você é um especialista em relógios de luxo que responde estritamente em JSON válido.' },
            { role: 'user', content: prompt }
          ]
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `HTTP ${response.status}`);
      }

      const data = await response.json();
      return data.choices?.[0]?.message?.content;
    }

    async function buscarComIA() {
      const referencia = document.getElementById('busca-ia-referencia').value.trim();
      if (!referencia) {
        alert('Por favor, insira uma referência, modelo ou link do relógio.');
        return;
      }

      if (!CONFIG.geminiKey && !CONFIG.groqKey) {
        alert('Configure ao menos uma chave de IA (Gemini ou Groq) nas configurações.');
        abrirModalConfig();
        return;
      }

      const btnBuscar = document.getElementById('btn-buscar-ia');
      const boxStatus = document.getElementById('busca-ia-status-box');
      const txtStatus = document.getElementById('busca-ia-status-txt');
      const textoOriginal = btnBuscar.innerHTML;

      const setStatus = (msg) => {
        if (txtStatus) txtStatus.innerText = msg;
        if (boxStatus) {
          boxStatus.classList.remove('hidden');
          boxStatus.classList.add('flex');
        }
      };

      btnBuscar.disabled = true;
      btnBuscar.innerHTML = `<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i><span>Consultando...</span>`;
      lucide.createIcons();
      setStatus(`Consultando catálogo internacional para "${referencia}"...`);

      const prompt = `Você é um especialista em relógios de luxo. Com base na seguinte referência: "${referencia}"

Extraia o máximo de informações técnicas possíveis e retorne APENAS um JSON válido com os campos que conseguir identificar. Use exatamente estes nomes de campos (deixe string vazia se não souber):
{
  "marca": "string",
  "modelo": "string",
  "tipo": "string (ex: Cronógrafo, Diver, etc)",
  "calibre": "string (Movimento/Calibre)",
  "cor_mostrador": "string",
  "diametro": "string (ex: 40mm)",
  "cor_caixa": "string (Cor da Caixa)",
  "cor_bisel": "string",
  "material_correia": "string (ex: Aço, Borracha, Couro)",
  "tipo_correia": "string (ex: Articulada, Bracelete, Correia)",
  "cor_correia": "string",
  "tipo_fecho": "string (ex: Fivela, Dobrável)",
  "descricao": "string (Descrição Técnica)"
}
Retorne APENAS o JSON.`;

      let content = null;
      let provedorUsado = '';
      try {
        if (CONFIG.geminiKey) {
          try {
            setStatus("Conectando ao Google Gemini (analisando calibre e caixa)...");
            content = await chamarGemini(referencia, prompt);
            provedorUsado = 'Google Gemini';
          } catch (errGemini) {
            console.warn('Gemini falhou ou demorou, tentando fallback Groq...', errGemini);
            if (!CONFIG.groqKey) throw errGemini;
            setStatus("Gemini indisponível. Acionando Groq AI de alta velocidade...");
          }
        }

        if (!content && CONFIG.groqKey) {
          setStatus("Consultando base através do Groq AI...");
          content = await chamarGroq(referencia, prompt);
          provedorUsado = 'Groq AI';
        }

        if (!content) throw new Error('Nenhuma resposta recebida dos provedores de IA.');
        
        setStatus("Processando ficha técnica e preenchendo o formulário...");
        content = content.trim();
        if (content.startsWith('```')) {
          content = content.replace(/```(?:json)?\n?/g, '').replace(/```$/g, '').trim();
        }
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('Nenhum JSON estruturado encontrado na resposta.');
        let jsonStr = jsonMatch[0].replace(/\\n/g, ' ').replace(/\\r/g, ' ');
        const dadosRelogio = JSON.parse(jsonStr);
        const campos = [
          'marca', 'modelo', 'tipo', 'calibre', 'cor_mostrador',
          'diametro', 'cor_caixa', 'cor_bisel', 'material_correia',
          'tipo_correia', 'cor_correia', 'tipo_fecho', 'descricao'
        ];
        let camposPreenchidos = 0;
        campos.forEach(campo => {
          if (dadosRelogio[campo] && dadosRelogio[campo].toString().trim() !== '') {
            const input = document.getElementById(campo);
            if (input) {
              input.value = dadosRelogio[campo];
              camposPreenchidos++;
            }
          }
        });

        if (camposPreenchidos === 0) {
          alert('Não foi possível extrair dados específicos deste relógio. Tente fornecer o nome da marca junto à referência.');
        } else {
          setStatus(`Ficha preenchida com sucesso via ${provedorUsado}!`);
          setTimeout(() => {
            if (boxStatus) {
              boxStatus.classList.add('hidden');
              boxStatus.classList.remove('flex');
            }
          }, 3500);
        }

      } catch (error) {
        console.error('Erro na busca com IA:', error);
        alert(`Erro na busca com IA: ${error.message}\n\nVerifique suas credenciais nas configurações.`);
        if (boxStatus) {
          boxStatus.classList.add('hidden');
          boxStatus.classList.remove('flex');
        }
      } finally {
        btnBuscar.disabled = false;
        btnBuscar.innerHTML = textoOriginal;
        lucide.createIcons();
      }
    }

    function obterDuracaoVideo(file) {
      return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.preload = 'metadata';
        const url = URL.createObjectURL(file);
        video.src = url;
        video.onloadedmetadata = () => {
          URL.revokeObjectURL(url);
          resolve(video.duration);
        };
        video.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error("Formato de vídeo inválido ou não suportado."));
        };
      });
    }

    function comprimirVideoNativo(file, maxLargura = 720, targetBitrate = 2500000) {
      return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.muted = true;
        video.playsInline = true;
        const url = URL.createObjectURL(file);
        video.src = url;
        video.onloadedmetadata = () =>
         {
          if (video.duration > 31) {
            URL.revokeObjectURL(url);
            return reject(new Error("O vídeo ultrapassa 30 segundos. Por favor, corte antes de enviar."));
          }

          let w = video.videoWidth;
          let h = video.videoHeight;
          if (w > maxLargura || h > maxLargura) {
            if (w > h) {
              h = Math.round(h * (maxLargura / w));
              w = maxLargura;
            } else {
              w = Math.round(w * (maxLargura / h));
              h = maxLargura;
            }
          }
          w = w % 2 === 0 ? w : w - 1;
          h = h % 2 === 0 ? h : h - 1;

          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          const stream = canvas.captureStream ? canvas.captureStream(24) : null;
          if (!stream) {
            URL.revokeObjectURL(url);
            return reject(new Error("Seu navegador não suporta captura de canvas para compressão."));
          }

          let mime = 'video/mp4';
          if (!MediaRecorder.isTypeSupported('video/mp4')) {
            mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp8') ? 'video/webm;codecs=vp8' : 'video/webm';
          }

          let mediaRecorder;
          try {
            mediaRecorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: targetBitrate });
          } catch (e) {
            mediaRecorder = new MediaRecorder(stream);
          }

          const chunks = [];
          mediaRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) chunks.push(e.data);
          };

          mediaRecorder.onstop = () => {
            URL.revokeObjectURL(url);
            stream.getTracks().forEach(track => track.stop());
            const ext = mime.includes('mp4') ? 'mp4' : 'webm';
            const blob = new Blob(chunks, { type: mime });
            const novoArquivo = new File([blob], file.name.replace(/\.[^/.]+$/, `.${ext}`), { type: mime });
            resolve(novoArquivo);
          };

          video.currentTime = 0;
          video.play().then(() => {
            mediaRecorder.start(100);
            function processarFrame() {
              if (video.paused || video.ended) {
                if (mediaRecorder.state === 'recording') mediaRecorder.stop();
                return;
              }
              ctx.drawImage(video, 0, 0, w, h);
              requestAnimationFrame(processarFrame);
            }
            processarFrame();
          }).catch(err => {
            URL.revokeObjectURL(url);
            stream.getTracks().forEach(track => track.stop());
            reject(err);
          });
        };

        video.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error("Formato de vídeo não suportado pelo navegador."));
        };
      });
    }

    document.getElementById('video-file')?.addEventListener('change', async function(e) {
      const file = e.target.files[0];
        if (!file) return;
      const nomeContainer = document.getElementById('video-manager-nome');
      const boxContainer = document.getElementById('video-manager-container');
        if (file.size > 80 * 1024 * 1024) {
        alert("O vídeo original ultrapassa 80MB. Grave um vídeo mais curto ou reduza a resolução na câmera.");
        this.value = '';
        return;
      }
      boxContainer.classList.remove('hidden');
      nomeContainer.innerText = "Analisando duração do vídeo...";
        try {
        const duracao = await obterDuracaoVideo(file);
        if (duracao > 31) {
          alert(`O vídeo selecionado tem ${Math.round(duracao)}s. O limite máximo permitido é de 30 segundos.`);
          this.value = '';
          boxContainer.classList.add('hidden');
          return;
        }
          if (file.size > 20 * 1024 * 1024) {
            nomeContainer.innerText = `Otimizando vídeo (${(file.size / (1024 * 1024)).toFixed(1)}MB)... aguarde`;
          const videoOtimizado = await comprimirVideoNativo(file);
          videoFileParaUpload = videoOtimizado;
          nomeContainer.innerText = `Vídeo otimizado: ${(videoOtimizado.size / (1024 * 1024)).toFixed(1)}MB (${Math.round(duracao)}s)`;
        } else {
          videoFileParaUpload = file;
          nomeContainer.innerText = `Vídeo anexado: ${(file.size / (1024 * 1024)).toFixed(1)}MB (${Math.round(duracao)}s)`;
        }
      } catch (err) {
        alert("Erro ao validar vídeo: " + err.message);
        this.value = '';
        boxContainer.classList.add('hidden');
      }
    });
        // Prévia imediata de fotos ao selecionar no Relógio
    document.getElementById('fotos-files')?.addEventListener('change', async function(e) {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const dataUrlComprimido = await comprimirImagem(file);
        fotosRelogioAtual.push(dataUrlComprimido);
      }
      this.value = ''; // Limpa para permitir selecionar mais fotos se quiser
      renderGerenciadorFotosRelogio();
    });

    // Prévia imediata de fotos ao selecionar na Caixa
    document.getElementById('caixa-fotos-files')?.addEventListener('change', async function(e) {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const dataUrlComprimido = await comprimirImagem(file);
        fotosCaixaAtual.push(dataUrlComprimido);
      }
      this.value = '';
      renderGerenciadorFotosCaixa();
    });

    function removerVideoRelogio() {
      if (videoRelogioAtual) videoRelogioExcluir = videoRelogioAtual;
      videoRelogioAtual = null;
      videoFileParaUpload = null;
      const inp = document.getElementById('video-file');
      if (inp) inp.value = '';
      document.getElementById('video-manager-container').classList.add('hidden');
    }

    function abrirModalCadastro() {
      document.getElementById('form-relogio').reset();
      document.getElementById('edit-id').value = '';
      document.getElementById('modal-form-title').innerText = "Cadastrar Novo Relógio";
      const btnDel = document.getElementById('btn-excluir-modal-relogio');
        if (btnDel) {
        btnDel.classList.add('hidden');
        btnDel.classList.remove('flex');
      }

      fotosRelogioAtual = []; fotosRelogioExcluir = [];
      videoRelogioAtual = null; videoRelogioExcluir = null; videoFileParaUpload = null;
      document.getElementById('video-manager-container').classList.add('hidden');
      renderGerenciadorFotosRelogio();
      atualizarLabelValor();
      abrirModalSuave('modal-cadastro');
    }
    function fecharModalCadastro() { fecharModalSuave('modal-cadastro'); }
    function editarRelogio(id) {
      const r = bancoDados.relogios.find(item => item.id === id);
        if (!r) return;
      const fileFotoInp = document.getElementById('fotos-files');
      const fileVidInp = document.getElementById('video-file');
        if (fileFotoInp) fileFotoInp.value = '';
        if (fileVidInp) fileVidInp.value = '';
      document.getElementById('modal-form-title').innerText = `Editar: ${r.marca} ${r.modelo}`;
      document.getElementById('edit-id').value = r.id;
      const btnDel = document.getElementById('btn-excluir-modal-relogio');
        if (btnDel) {        btnDel.classList.remove('hidden');        btnDel.classList.add('flex');      }
      document.getElementById('marca').value = r.marca || '';
      document.getElementById('modelo').value = r.modelo || '';
      document.getElementById('tipo').value = r.tipo || '';
      document.getElementById('tipo-aquisicao').value = r.tipo_aquisicao || 'compra';
      document.getElementById('data_compra').value = r.data_compra || '';
      document.getElementById('valor').value = r.valor || '';
      document.getElementById('origem').value = r.origem || '';
      document.getElementById('rating-prestigio').value = r.prestigio || '5';
      document.getElementById('rating-afeto').value = r.afeto || '5';
      document.getElementById('rating-valor').value = r.valor_rating || '5';
      document.getElementById('calibre').value = r.calibre || '';
      document.getElementById('cor_mostrador').value = r.cor_mostrador || '';
      document.getElementById('diametro').value = r.diametro || '';
      document.getElementById('cor_caixa').value = r.cor_caixa || '';
      document.getElementById('cor_bisel').value = r.cor_bisel || '';
      document.getElementById('material_correia').value = r.material_correia || '';
      document.getElementById('tipo_correia').value = r.tipo_correia || '';
      document.getElementById('cor_correia').value = r.cor_correia || '';
      document.getElementById('tipo_fecho').value = r.tipo_fecho || '';
      document.getElementById('descricao').value = r.descricao || '';
      document.getElementById('historia').value = r.historia || '';
      fotosRelogioAtual = [...(r.fotos || [])]; 
      fotosRelogioExcluir = [];
      videoRelogioAtual = r.video || null;
      videoRelogioExcluir = null;
      videoFileParaUpload = null;
      const vContainer = document.getElementById('video-manager-container');
        if (videoRelogioAtual) {
        document.getElementById('video-manager-nome').innerText = "Vídeo atual anexado";
        vContainer.classList.remove('hidden');
      } else {
        vContainer.classList.add('hidden');
      }
      renderGerenciadorFotosRelogio();
      atualizarLabelValor();
      abrirModalSuave('modal-cadastro');
      lucide.createIcons();
    }

    function excluirRelogioModalAtual() {
      const id = document.getElementById('edit-id').value;
      if (!id) return;
      fecharModalCadastro();
      removerRelogio(id);
    }

    async function salvarRelogioLocal(e) {
      e.preventDefault();
      const editId = document.getElementById('edit-id').value;
      const targetId = editId || `rlg-${Date.now()}`;
        pendingChanges.fotosParaExcluir.push(...fotosRelogioExcluir);
        if (videoRelogioExcluir) {
        pendingChanges.videosParaExcluir.push(videoRelogioExcluir);        }
        if (editId && videoFileParaUpload) {
        const relogioAntigo = bancoDados.relogios.find(r => r.id === editId);
        if (relogioAntigo && relogioAntigo.video && !pendingChanges.videosParaExcluir.includes(relogioAntigo.video)) {
          pendingChanges.videosParaExcluir.push(relogioAntigo.video);        }
      }
        if (videoFileParaUpload) {
        pendingChanges.videosParaEnviar.push({ file: videoFileParaUpload, relogioId: targetId });
        videoRelogioAtual = URL.createObjectURL(videoFileParaUpload);
      }
  // Enfileira apenas as fotos novas (base64) do relógio sem duplicar
  fotosRelogioAtual.forEach((url, i) => {
    if (url.startsWith('data:')) {
      const jaEnfileirado = pendingChanges.fotosParaEnviar.some(p => p.tempUrl === url);
      if (!jaEnfileirado) {
        pendingChanges.fotosParaEnviar.push({
          blob: dataUrlToBlob(url),
          nomeOriginal: `foto_${i}.jpg`,
          itemId: targetId,
          isCaixa: false,
          tempUrl: url
        });
      }
    }
  });

      const dadosRelogio = {
        id: targetId,
        marca: document.getElementById('marca').value.trim(),
        modelo: document.getElementById('modelo').value.trim(),
        tipo: document.getElementById('tipo').value.trim(),
        tipo_aquisicao: document.getElementById('tipo-aquisicao').value,
        data_compra: document.getElementById('data_compra').value,
        valor: parseFloat(document.getElementById('valor').value) || 0,
        origem: document.getElementById('origem').value.trim(),
        prestigio: parseInt(document.getElementById('rating-prestigio').value) || 5,
        afeto: parseInt(document.getElementById('rating-afeto').value) || 5,
        valor_rating: parseInt(document.getElementById('rating-valor').value) || 5,
        calibre: document.getElementById('calibre').value.trim(),
        cor_mostrador: document.getElementById('cor_mostrador').value.trim(),
        diametro: document.getElementById('diametro').value.trim(),
        cor_caixa: document.getElementById('cor_caixa').value.trim(),
        cor_bisel: document.getElementById('cor_bisel').value.trim(),
        material_correia: document.getElementById('material_correia').value.trim(),
        tipo_correia: document.getElementById('tipo_correia').value.trim(),
        cor_correia: document.getElementById('cor_correia').value.trim(),
        tipo_fecho: document.getElementById('tipo_fecho').value.trim(),
        descricao: document.getElementById('descricao').value.trim(),
        historia: document.getElementById('historia').value.trim(),
        fotos: fotosRelogioAtual,
        video: videoRelogioAtual
      };
        if (editId) { 
        const idx = bancoDados.relogios.findIndex(r => r.id === editId); 
        if (idx !== -1) bancoDados.relogios[idx] = dadosRelogio; 
      } else { 
        bancoDados.relogios.push(dadosRelogio); 
      }
      bancoDados.relogios.sort((a, b) => new Date(a.data_compra || 0) - new Date(b.data_compra || 0));
      fecharModalCadastro();
      atualizarStatusPendencias(true);
      renderizarTudo();
      if (abaAtiva === 'geral') carregarDashboardGeral();
      if (abaAtiva === 'galeria') renderizarGaleria();
      salvarEstadoLocalIndexedDB();
    }

async function salvarCaixaLocal(e) {
  e.preventDefault();
  const editId = document.getElementById('edit-caixa-id').value;
  const targetId = editId || `box-${Date.now()}`;
  
  pendingChanges.fotosParaExcluir.push(...fotosCaixaExcluir);

  // Enfileira apenas as fotos novas (base64) da caixa sem duplicar
  fotosCaixaAtual.forEach((url, i) => {
    if (url.startsWith('data:')) {
      const jaEnfileirado = pendingChanges.fotosParaEnviar.some(p => p.tempUrl === url);
      if (!jaEnfileirado) {
        pendingChanges.fotosParaEnviar.push({
          blob: dataUrlToBlob(url),
          nomeOriginal: `caixa_${i}.jpg`,
          itemId: targetId,
          isCaixa: true,
          tempUrl: url
        });
      }
    }
  });

  const dadosCaixa = {
    id: targetId,
    nome: document.getElementById('caixa-nome').value.trim(),
    capacidade: parseInt(document.getElementById('caixa-capacidade').value) || 0,
    data_aquisicao: document.getElementById('caixa-data').value,
    status: document.getElementById('caixa-status').value.trim(),
    observacoes: document.getElementById('caixa-obs').value.trim(),
    fotos: fotosCaixaAtual
  };

  if (editId) { 
    const idx = bancoDados.caixas.findIndex(c => c.id === editId); 
    if (idx !== -1) bancoDados.caixas[idx] = dadosCaixa; 
  } else { 
    bancoDados.caixas.push(dadosCaixa); 
  }
  bancoDados.caixas.sort((a, b) => new Date(a.data_aquisicao || 0) - new Date(b.data_aquisicao || 0));
  fecharModalCaixa();
  atualizarStatusPendencias(true);
  renderizarTudo();
  if (abaAtiva === 'geral') carregarDashboardGeral();
  if (abaAtiva === 'galeria') renderizarGaleria();
  salvarEstadoLocalIndexedDB();
}

    function removerRelogio(id) {
      const idx = bancoDados.relogios.findIndex(r => r.id === id);
        if (idx === -1) return;
      const relogio = bancoDados.relogios[idx];
        if (!confirm(`Remover "${relogio.modelo}" do acervo local? As mídias serão removidas ao sincronizar.`)) return;
      pendingChanges.fotosParaEnviar = pendingChanges.fotosParaEnviar.filter(f => f.itemId !== id);
        if (pendingChanges.videosParaEnviar) {
        pendingChanges.videosParaEnviar = pendingChanges.videosParaEnviar.filter(v => v.relogioId !== id);
      }
        if (relogio.fotos) pendingChanges.fotosParaExcluir.push(...relogio.fotos);
        if (relogio.video) {
        if (!pendingChanges.videosParaExcluir) pendingChanges.videosParaExcluir = [];
        pendingChanges.videosParaExcluir.push(relogio.video);
      }
      bancoDados.relogios.splice(idx, 1);
      atualizarStatusPendencias(true);
      renderizarTudo();
      if (abaAtiva === 'geral') carregarDashboardGeral();
      if (abaAtiva === 'galeria') renderizarGaleria();
      salvarEstadoLocalIndexedDB();
    }

    function removerCaixa(id) {
      const idx = bancoDados.caixas.findIndex(c => c.id === id);
        if (idx === -1) return;
      const caixa = bancoDados.caixas[idx];
        if (!confirm(`Remover caixa "${caixa.nome}"? As fotos serão removidas ao sincronizar.`)) return;
      pendingChanges.fotosParaEnviar = pendingChanges.fotosParaEnviar.filter(f => f.itemId !== id);
        if (caixa.fotos) pendingChanges.fotosParaExcluir.push(...caixa.fotos);
      bancoDados.caixas.splice(idx, 1);
      atualizarStatusPendencias(true);
      renderizarTudo();
        if (abaAtiva === 'geral') carregarDashboardGeral();      salvarEstadoLocalIndexedDB();
    }

    async function sincronizarTudoComGithub() {
      if (!CONFIG.token) { 
        alert("Configure seu Token do GitHub antes de sincronizar!"); 
        abrirModalConfig(); 
        return; 
      }
      
      const btnSync = document.getElementById('btn-sync-all');
      btnSync.disabled = true;
      btnSync.innerHTML = `<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i><span>Sincronizando...</span>`;
      lucide.createIcons();
      try {
        await obterShaAtual();
        const fotosExcluirUnicas = [...new Set(pendingChanges.fotosParaExcluir)];
        while (fotosExcluirUnicas.length > 0) {
          const url = fotosExcluirUnicas[0];
          await deletarArquivoFisicoGithub(url);
          fotosExcluirUnicas.shift();
          pendingChanges.fotosParaExcluir = pendingChanges.fotosParaExcluir.filter(u => u !== url);
        }

        const videosExcluirUnicos = [...new Set(pendingChanges.videosParaExcluir || [])];
        while (videosExcluirUnicos.length > 0) {
          const url = videosExcluirUnicos[0];
          await deletarArquivoFisicoGithub(url);
          videosExcluirUnicos.shift();
          pendingChanges.videosParaExcluir = pendingChanges.videosParaExcluir.filter(u => u !== url);
        }

        while (pendingChanges.fotosParaEnviar.length > 0) {
          const item = pendingChanges.fotosParaEnviar[0];
          const nomeBase = (item.nomeOriginal || item.file?.name || 'foto.jpg').replace(/\.[^/.]+$/, '');
          const nomeLimpo = nomeBase.replace(/[^a-zA-Z0-9._-]/g, '_');
          const prefixo = item.isCaixa ? 'caixa' : 'watch';
          const nomeArquivo = `images/${prefixo}-${Date.now()}-${nomeLimpo}.jpg`;
          const blobParaEnviar = item.blob || item.file;
          const base64Content = await toBase64(blobParaEnviar);
          const res = await fetch(`https://api.github.com/repos/${CONFIG.user}/${CONFIG.repo}/contents/${nomeArquivo}`, {
            method: 'PUT', 
            headers: { Authorization: `token ${CONFIG.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: `upload: ${nomeLimpo}.jpg`, content: base64Content })
          });
            if (!res.ok) {
            const errJson = await res.json().catch(() => ({}));
            throw new Error(`Falha no upload da foto (${nomeLimpo}): ` + tratarErroHttpGithub(res, errJson));
          }
          const imgData = await res.json();
          const githubUrl = imgData.content.download_url;
// Apenas substitui se ela ainda existir no item (não faça push caso tenha sido excluída)
if (item.isCaixa) {
  const caixaAlvo = bancoDados.caixas.find(c => c.id === item.itemId);
  if (caixaAlvo && caixaAlvo.fotos) { 
    const idxFoto = caixaAlvo.fotos.indexOf(item.tempUrl); 
    if (idxFoto !== -1) caixaAlvo.fotos[idxFoto] = githubUrl; 
  }
} else {
  const relogioAlvo = bancoDados.relogios.find(r => r.id === item.itemId);
  if (relogioAlvo && relogioAlvo.fotos) { 
    const idxFoto = relogioAlvo.fotos.indexOf(item.tempUrl); 
    if (idxFoto !== -1) relogioAlvo.fotos[idxFoto] = githubUrl; 
  }
}
          pendingChanges.fotosParaEnviar.shift();
        }
            if (pendingChanges.videosParaEnviar) {
            while (pendingChanges.videosParaEnviar.length > 0) {
            const itemVid = pendingChanges.videosParaEnviar[0];
            const ext = itemVid.file.type?.includes('webm') ? 'webm' : 'mp4';
            const base64Vid = await toBase64(itemVid.file);
            const nomeVid = `videos/video-${itemVid.relogioId}-${Date.now()}.${ext}`;
            const resVid = await fetch(`https://api.github.com/repos/${CONFIG.user}/${CONFIG.repo}/contents/${nomeVid}`, {
              method: 'PUT',
              headers: { Authorization: `token ${CONFIG.token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: `upload video: ${itemVid.relogioId}`, content: base64Vid })
            });
              if (!resVid.ok) {
            const errJson = await resVid.json().catch(() => ({}));
              throw new Error(`Falha no upload do vídeo: ` + tratarErroHttpGithub(resVid, errJson));
            }
            const vidData = await resVid.json();
            const rAlvo = bancoDados.relogios.find(r => r.id === itemVid.relogioId);
              if (rAlvo) rAlvo.video = vidData.content.download_url;
            pendingChanges.videosParaEnviar.shift();
          }
        }
        const shaEsperado = await salvarJsonGithub("chore: sincronização em lote de relógios e caixas");
        await limparEstadoLocalIndexedDB();
        atualizarStatusPendencias(false);
        iniciarVerificacaoDeploy(shaEsperado);
      } catch (err) {
        alert("Erro na sincronização: " + err.message);
        btnSync.disabled = false;
        btnSync.innerHTML = `<i data-lucide="cloud-upload" class="w-3.5 h-3.5"></i><span>Sincronizar</span>`;
        lucide.createIcons();
      }
    }
   
    async function salvarJsonGithub(mensagemCommit) {
      const updatedJsonContent = btoa(unescape(encodeURIComponent(JSON.stringify(bancoDados, null, 2))));
      const shaEsperado = await calcularShaEsperado(updatedJsonContent);
      const res = await fetch(`https://api.github.com/repos/${CONFIG.user}/${CONFIG.repo}/contents/relogios.json`, {
        method: 'PUT', 
        headers: { Authorization: `token ${CONFIG.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: mensagemCommit, content: updatedJsonContent, sha: fileSha })
      });
        if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error("Erro ao salvar relogios.json: " + tratarErroHttpGithub(res, errJson));
      }
      const resData = await res.json();
      if (resData.content && resData.content.sha) {
        fileSha = resData.content.sha;
      }
      return shaEsperado;
    }

    function tratarErroHttpGithub(res, corpoErro = {}) {
      if (res.status === 401) {
        return "Token do GitHub inválido, revogado ou expirado. Verifique as configurações.";
      }
      if (res.status === 403) {
        const remaining = res.headers.get('x-ratelimit-remaining');
        if (remaining === '0') {
          const resetTime = new Date(res.headers.get('x-ratelimit-reset') * 1000).toLocaleTimeString();
          return `Limite de requisições do GitHub excedido! O limite será liberado às ${resetTime}.`;
        }
        return "Acesso proibido (403). Seu Token PAT precisa de permissão de escrita ('repo' ou 'contents:write').";
      }
      if (res.status === 404) {
        return "Repositório ou arquivo não encontrado. Verifique Usuário e Nome do Repositório nas configurações.";
      }
      if (res.status === 409) {
        return "Conflito de versão (409): o arquivo no GitHub foi alterado recentemente. Tente sincronizar novamente.";
      }
      return corpoErro.message || `Erro HTTP ${res.status}`;
    }

    async function calcularShaEsperado(conteudoBase64) {
      const conteudoRaw = Uint8Array.from(atob(conteudoBase64), c => c.charCodeAt(0));
      const header = new TextEncoder().encode(`blob ${conteudoRaw.length}\0`);
      const combined = new Uint8Array(header.length + conteudoRaw.length);
      combined.set(header);
      combined.set(conteudoRaw, header.length);
      const hashBuffer = await crypto.subtle.digest('SHA-1', combined);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    function iniciarVerificacaoDeploy(shaEsperado) {
      const modal = document.getElementById('modal-deploy');
      const countdown = document.getElementById('deploy-countdown');
      const progressBar = document.getElementById('deploy-progress-bar');
      const ponteiroRelogio = document.getElementById('deploy-clock-hand');
        if (modal) modal.classList.remove('hidden');
        if (countdown) countdown.textContent = 'Publicando...';
        if (progressBar) progressBar.style.width = '0%';
        if (ponteiroRelogio) ponteiroRelogio.style.transform = 'rotate(0deg)';
      const maxTentativas = 60;
      const intervaloMs = 5000;
      let tentativa = 0;
      
      async function verificar() {
        tentativa++;
        const percentual = Math.min((tentativa / maxTentativas) * 100, 100);
          if (progressBar) progressBar.style.width = `${percentual}%`;
          if (countdown) countdown.textContent = `Verificando... ${tentativa}/${maxTentativas}`;
          if (ponteiroRelogio) {
          ponteiroRelogio.style.transform = `rotate(${tentativa * 6}deg)`;
        }
        try {
          const respostaRaw = await fetch(`relogios.json?t=${Date.now()}`, {
            cache: 'no-store'
          });
          if (!respostaRaw.ok) {
            throw new Error(`HTTP ${respostaRaw.status}`);
          }
          const textoJson = await respostaRaw.text();
          const base64Json = btoa(unescape(encodeURIComponent(textoJson)));
          const shaPublicado = await calcularShaEsperado(base64Json);
            if (shaPublicado === shaEsperado) {
            if (countdown) countdown.textContent = 'Publicado! Recarregando...';
            if (progressBar) progressBar.style.width = '100%';
            if (ponteiroRelogio) ponteiroRelogio.style.transform = 'rotate(360deg)';
              setTimeout(() => {
              location.reload();
            }, 1000);
            return;
          }
        
          console.log(`[DeployCheck] tentativa ${tentativa}: SHA não corresponde.`);
          
        } catch (erro) {
          console.warn(`[DeployCheck] tentativa ${tentativa}: ${erro.message}`);
        }
        
        if (tentativa < maxTentativas) {
          setTimeout(verificar, intervaloMs);
        } else {
          if (countdown) countdown.textContent = 'Tempo esgotado. Recarregando...';
          if (progressBar) progressBar.style.width = '100%';
          setTimeout(() => {
            location.reload();
          }, 1000);
        }
      }
      verificar();
    }

    function definirFiltroPill(pill) {
      filtroPillAtivo = pill;
      renderizarPillsFiltros();
      aplicarFiltrosEOrdem();
    }

    function renderizarPillsFiltros() {
      const container = document.getElementById('pills-filtros');
        if (!container) return;
      const totalTodos = bancoDados.relogios.length;
      const totalPres = bancoDados.relogios.filter(r => r.tipo_aquisicao === 'presente').length;
      const totalAut = bancoDados.relogios.filter(r => (r.calibre || '').toLowerCase().match(/autom|nh3|miyota/)).length;
      const totalQtz = bancoDados.relogios.filter(r => (r.calibre || '').toLowerCase().match(/quart|bateria/)).length;
      const totalCrono = bancoDados.relogios.filter(r => (r.tipo || '').toLowerCase().includes('cron')).length;
      const totalDiver = bancoDados.relogios.filter(r => (r.tipo || '').toLowerCase().includes('diver')).length;
      const pills = [
        { id: 'todos', label: `Todos (${totalTodos})`, icon: 'layers' },
        { id: 'presente', label: `Presentes (${totalPres})`, icon: 'gift' },
        { id: 'automatico', label: `Automáticos (${totalAut})`, icon: 'cog' },
        { id: 'quartzo', label: `Quartzo (${totalQtz})`, icon: 'zap' },
        { id: 'cronografo', label: `Cronógrafos (${totalCrono})`, icon: 'timer' },
        { id: 'diver', label: `Diver (${totalDiver})`, icon: 'anchor' }
      ];

      container.innerHTML = pills.map(p => {
        const ativo = filtroPillAtivo === p.id;
        const cls = ativo
          ? "bg-sky-500 text-slate-950 font-semibold shadow-sm"
          : "border border-slate-200 dark:border-[#1b2f4d] bg-white dark:bg-[#070e1a] text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white";
        return `
          <button type="button" onclick="definirFiltroPill('${p.id}')" class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full whitespace-nowrap transition text-[11px] ${cls}">
            <i data-lucide="${p.icon}" class="w-3 h-3 flex-shrink-0"></i>
            <span>${p.label}</span>
          </button>
        `;
      }).join('');
      lucide.createIcons();
    }

    function aplicarFiltrosEOrdem() {
      const termo = (document.getElementById('search').value || '').toLowerCase();
      const criterio = document.getElementById('sort-select').value;
        let filtrados = bancoDados.relogios.filter(r => {
      const atendeBusca = (r.marca && r.marca.toLowerCase().includes(termo)) ||
          (r.modelo && r.modelo.toLowerCase().includes(termo)) ||
          (r.tipo && r.tipo.toLowerCase().includes(termo)) ||
          (r.calibre && r.calibre.toLowerCase().includes(termo)) ||
          (r.cor_mostrador && r.cor_mostrador.toLowerCase().includes(termo));
        if (!atendeBusca) return false;
        if (filtroPillAtivo === 'todos') return true;
        if (filtroPillAtivo === 'presente') return r.tipo_aquisicao === 'presente';
        const cal = (r.calibre || '').toLowerCase();
        if (filtroPillAtivo === 'automatico') return cal.includes('autom') || cal.includes('nh3') || cal.includes('miyota');
        if (filtroPillAtivo === 'quartzo') return cal.includes('quart') || cal.includes('bateria');
        const tip = (r.tipo || '').toLowerCase();
        if (filtroPillAtivo === 'diver') return tip.includes('diver');
        if (filtroPillAtivo === 'cronografo') return tip.includes('cron');
        return true;
      });

      filtrados.sort((a, b) => {
        if (criterio === 'data_asc') return new Date(a.data_compra || 0) - new Date(b.data_compra || 0);
        if (criterio === 'data_desc') return new Date(b.data_compra || 0) - new Date(a.data_compra || 0);
        if (criterio === 'valor_desc') return (b.valor || 0) - (a.valor || 0);
        if (criterio === 'valor_asc') return (a.valor || 0) - (b.valor || 0);
        if (criterio === 'marca_asc') return (a.marca || '').localeCompare(b.marca || '');
        return new Date(b.data_compra || 0) - new Date(a.data_compra || 0);
      });
      renderRelogios(filtrados);
    }

    document.getElementById('search').addEventListener('input', () => {
      clearTimeout(debounceSearchTimer);
      debounceSearchTimer = setTimeout(aplicarFiltrosEOrdem, 300);
    });

    function toBase64(fileOrBlob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const res = reader.result;
          resolve(res.split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(fileOrBlob);
      });
    }

    // ================= GERENCIADOR DE FOTOS: RELÓGIOS =================
    function renderGerenciadorFotosRelogio() {
      const container = document.getElementById('fotos-manager-container');
      const list = document.getElementById('fotos-manager-list');
      if (!container || !list) return;

      if (fotosRelogioAtual.length === 0) {
        container.classList.add('hidden');
        list.innerHTML = '';
        return;
      }

      container.classList.remove('hidden');
      list.innerHTML = fotosRelogioAtual.map((url, idx) => `
        <div class="relative group rounded-lg overflow-hidden border border-slate-300 dark:border-slate-700 bg-black aspect-square flex items-center justify-center">
          <img src="${url}" class="w-full h-full object-cover">
          
          ${idx === 0 
            ? '<span class="absolute top-1 left-1 bg-sky-500 text-slate-950 font-bold text-[9px] px-1.5 py-0.5 rounded shadow z-10 flex items-center gap-0.5">★ Capa</span>' 
            : `<button type="button" onclick="definirCapaRelogio(${idx})" title="Tornar Capa Principal" class="absolute top-1 left-1 bg-black/70 hover:bg-sky-500 text-white hover:text-slate-950 p-1 rounded transition text-[10px] font-bold z-10 shadow">
                 <i data-lucide="star" class="w-3 h-3"></i>
               </button>`
          }

          <div class="absolute bottom-1 inset-x-1 flex items-center justify-between gap-1 opacity-90 sm:opacity-0 sm:group-hover:opacity-100 transition z-10">
            <div class="flex gap-1">
              ${idx > 0 ? `
                <button type="button" onclick="moverFotoRelogio(${idx}, -1)" title="Mover para esquerda" class="bg-black/80 hover:bg-slate-800 text-white p-1 rounded shadow">
                  <i data-lucide="chevron-left" class="w-3 h-3"></i>
                </button>
              ` : ''}
              ${idx < fotosRelogioAtual.length - 1 ? `
                <button type="button" onclick="moverFotoRelogio(${idx}, 1)" title="Mover para direita" class="bg-black/80 hover:bg-slate-800 text-white p-1 rounded shadow">
                  <i data-lucide="chevron-right" class="w-3 h-3"></i>
                </button>
              ` : ''}
            </div>
            <button type="button" onclick="excluirFotoGerenciadorRelogio(${idx})" title="Excluir Foto" class="bg-red-600/90 hover:bg-red-500 text-white p-1 rounded shadow ml-auto">
              <i data-lucide="trash-2" class="w-3 h-3"></i>
            </button>
          </div>
        </div>
      `).join('');
      lucide.createIcons();
    }

    function definirCapaRelogio(idx) {
      if (idx <= 0 || idx >= fotosRelogioAtual.length) return;
      const foto = fotosRelogioAtual.splice(idx, 1)[0];
      fotosRelogioAtual.unshift(foto);
      renderGerenciadorFotosRelogio();
    }

    function moverFotoRelogio(idx, direcao) {
      const novoIdx = idx + direcao;
      if (novoIdx < 0 || novoIdx >= fotosRelogioAtual.length) return;
      const temp = fotosRelogioAtual[idx];
      fotosRelogioAtual[idx] = fotosRelogioAtual[novoIdx];
      fotosRelogioAtual[novoIdx] = temp;
      renderGerenciadorFotosRelogio();
    }

function excluirFotoGerenciadorRelogio(idx) {
  const removida = fotosRelogioAtual.splice(idx, 1)[0];
  if (removida) {
    if (removida.startsWith('data:')) {
      // Remove da fila pendente se ainda não subiu
      pendingChanges.fotosParaEnviar = pendingChanges.fotosParaEnviar.filter(p => p.tempUrl !== removida);
    } else {
      fotosRelogioExcluir.push(removida);
    }
  }
  renderGerenciadorFotosRelogio();
}

    // ================= GERENCIADOR DE FOTOS: CAIXAS =================
    function renderGerenciadorFotosCaixa() {
      const container = document.getElementById('caixa-fotos-container');
      const list = document.getElementById('caixa-fotos-list');
      if (!container || !list) return;

      if (fotosCaixaAtual.length === 0) {
        container.classList.add('hidden');
        list.innerHTML = '';
        return;
      }

      container.classList.remove('hidden');
      list.innerHTML = fotosCaixaAtual.map((url, idx) => `
        <div class="relative group rounded-lg overflow-hidden border border-slate-300 dark:border-slate-700 bg-black aspect-square flex items-center justify-center">
          <img src="${url}" class="w-full h-full object-cover">

          ${idx === 0 
            ? '<span class="absolute top-1 left-1 bg-amber-500 text-slate-950 font-bold text-[9px] px-1.5 py-0.5 rounded shadow z-10 flex items-center gap-0.5">★ Capa</span>' 
            : `<button type="button" onclick="definirCapaCaixa(${idx})" title="Tornar Capa Principal" class="absolute top-1 left-1 bg-black/70 hover:bg-amber-500 text-white hover:text-slate-950 p-1 rounded transition text-[10px] font-bold z-10 shadow">
                 <i data-lucide="star" class="w-3 h-3"></i>
               </button>`
          }

          <div class="absolute bottom-1 inset-x-1 flex items-center justify-between gap-1 opacity-90 sm:opacity-0 sm:group-hover:opacity-100 transition z-10">
            <div class="flex gap-1">
              ${idx > 0 ? `
                <button type="button" onclick="moverFotoCaixa(${idx}, -1)" title="Mover para esquerda" class="bg-black/80 hover:bg-slate-800 text-white p-1 rounded shadow">
                  <i data-lucide="chevron-left" class="w-3 h-3"></i>
                </button>
              ` : ''}
              ${idx < fotosCaixaAtual.length - 1 ? `
                <button type="button" onclick="moverFotoCaixa(${idx}, 1)" title="Mover para direita" class="bg-black/80 hover:bg-slate-800 text-white p-1 rounded shadow">
                  <i data-lucide="chevron-right" class="w-3 h-3"></i>
                </button>
              ` : ''}
            </div>
            <button type="button" onclick="excluirFotoGerenciadorCaixa(${idx})" title="Excluir Foto" class="bg-red-600/90 hover:bg-red-500 text-white p-1 rounded shadow ml-auto">
              <i data-lucide="trash-2" class="w-3 h-3"></i>
            </button>
          </div>
        </div>
      `).join('');
      lucide.createIcons();
    }

    function definirCapaCaixa(idx) {
      if (idx <= 0 || idx >= fotosCaixaAtual.length) return;
      const foto = fotosCaixaAtual.splice(idx, 1)[0];
      fotosCaixaAtual.unshift(foto);
      renderGerenciadorFotosCaixa();
    }

    function moverFotoCaixa(idx, direcao) {
      const novoIdx = idx + direcao;
      if (novoIdx < 0 || novoIdx >= fotosCaixaAtual.length) return;
      const temp = fotosCaixaAtual[idx];
      fotosCaixaAtual[idx] = fotosCaixaAtual[novoIdx];
      fotosCaixaAtual[novoIdx] = temp;
      renderGerenciadorFotosCaixa();
    }

function excluirFotoGerenciadorCaixa(idx) {
  const removida = fotosCaixaAtual.splice(idx, 1)[0];
  if (removida) {
    if (removida.startsWith('data:')) {
      pendingChanges.fotosParaEnviar = pendingChanges.fotosParaEnviar.filter(p => p.tempUrl !== removida);
    } else {
      fotosCaixaExcluir.push(removida);
    }
  }
  renderGerenciadorFotosCaixa();
}
// Estado padrão caso não exista ainda no JSON
const SOBRE_PADRAO = {
  titulo: "Tempo, Memórias & Legado",
  conteudo: "Esta coleção não é sobre contagem de horas ou peças guardadas em caixas.\n\nÉ o registro dos caminhos percorridos, das vitórias comemoradas, dos presentes recebidos e dos marcos da vida. Cada relógio guarda o eco de um dia especial.\n\nQue quem ler estas palavras encontre nelas não apenas mostradores e engrenagens, mas um pedaço vivo da minha história.",
  atualizado_em: "04/11/2026"
};

function renderizarSobre() {
  // Ajustado: usa bancoDados em vez de dadosApp
  const dadosSobre = bancoDados?.sobre || SOBRE_PADRAO;
  
  const elTitulo = document.getElementById('sobre-titulo-view');
  const elData = document.getElementById('sobre-data-view');
  const elConteudo = document.getElementById('sobre-conteudo-view');
  const elAdminAction = document.getElementById('admin-sobre-actions');

  if (elTitulo) elTitulo.innerText = dadosSobre.titulo || SOBRE_PADRAO.titulo;
  if (elData) elData.innerText = `Última atualização: ${dadosSobre.atualizado_em || '--/--/----'}`;
  if (elConteudo) elConteudo.innerText = dadosSobre.conteudo || SOBRE_PADRAO.conteudo;

  // Ajustado: usa modoVisitante (variável real do seu código)
  if (elAdminAction) {
    if (modoVisitante) {
      elAdminAction.classList.add('hidden');
    } else {
      elAdminAction.classList.remove('hidden');
    }
  }

  if (window.lucide) lucide.createIcons();
}

function abrirModalEditarSobre() {
  const dadosSobre = bancoDados?.sobre || SOBRE_PADRAO;
  document.getElementById('input-sobre-titulo').value = dadosSobre.titulo || '';
  document.getElementById('input-sobre-conteudo').value = dadosSobre.conteudo || '';
  document.getElementById('modal-sobre').classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
}

function fecharModalEditarSobre() {
  document.getElementById('modal-sobre').classList.add('hidden');
}

async function salvarSobre() {
  const titulo = document.getElementById('input-sobre-titulo').value.trim();
  const conteudo = document.getElementById('input-sobre-conteudo').value.trim();
  const hoje = new Date().toLocaleDateString('pt-BR');

  // Atualiza os dados no banco
  if (!bancoDados.sobre) bancoDados.sobre = {};
  bancoDados.sobre.titulo = titulo || SOBRE_PADRAO.titulo;
  bancoDados.sobre.conteudo = conteudo;
  bancoDados.sobre.atualizado_em = hoje;

  // 1. Marca a pendência primeiro
  atualizarStatusPendencias(true);

  // 2. Persiste localmente no IndexedDB
  await salvarEstadoLocalIndexedDB();

  fecharModalEditarSobre();
  renderizarSobre();

  // 3. Sincroniza automaticamente (se você quiser sincronizar na hora):
  if (typeof sincronizarTudoComGithub === 'function') {
    sincronizarTudoComGithub();
  }
}
    // ================= RENDERIZAR ARQUIVO / EX-COLEÇÃO =================
    function renderizarExColecao() {
      const grid = document.getElementById('grid-ex-colecao');
      if (!grid) return;

      const lista = bancoDados.ex_colecao || [];

      if (lista.length === 0) {
        grid.innerHTML = `
          <div class="col-span-full py-16 text-center text-slate-500">
            <i data-lucide="archive" class="w-10 h-10 mx-auto mb-2 opacity-40"></i>
            <p>Nenhuma peça no arquivo histórico.</p>
          </div>`;
        if (window.lucide) lucide.createIcons();
        return;
      }

      grid.innerHTML = lista.map(item => `
        <div class="card-navy rounded-xl overflow-hidden flex flex-col justify-between border border-slate-200/50 dark:border-[#132238]">
          <div class="relative h-52 sm:h-56 bg-slate-900 overflow-hidden flex items-center justify-center">
            <img src="${item.foto}" alt="${item.modelo}" class="w-full h-full object-cover filter grayscale-[25%] hover:grayscale-0 transition duration-300" onerror="this.src='https://placehold.co/600x600/0a1322/38bdf8?text=Sem+Foto'">
            <span class="absolute top-2.5 right-2.5 bg-black/80 backdrop-blur border border-slate-700/60 px-2 py-0.5 rounded text-[10px] font-mono text-slate-300">
              Saída: ${item.anoSaida || 'N/A'}
            </span>
            ${item.motivo ? `<span class="absolute bottom-2.5 left-2.5 bg-rose-500/80 text-white text-[10px] px-2 py-0.5 rounded font-medium">${item.motivo}</span>` : ''}
          </div>
          <div class="p-3.5 sm:p-4 flex-1 flex flex-col justify-between">
            <div>
              <div class="flex justify-between items-baseline">
                <p class="text-[11px] uppercase tracking-widest text-slate-500 dark:text-slate-400 font-bold">${item.marca}</p>
                <span class="text-[10px] text-slate-400 font-mono">${item.movimento || ''}</span>
              </div>
              <h3 class="text-sm font-semibold text-slate-900 dark:text-white mt-0.5">${item.modelo}</h3>
              ${item.notas ? `<p class="text-xs text-slate-600 dark:text-slate-300 mt-2 leading-relaxed bg-slate-100/50 dark:bg-slate-900/50 p-2.5 rounded-lg border border-slate-200/40 dark:border-slate-800/80 italic">"${item.notas}"</p>` : ''}
            </div>
          </div>
        </div>
      `).join('');

      if (window.lucide) lucide.createIcons();
    }

window.onload = carregarDados;
