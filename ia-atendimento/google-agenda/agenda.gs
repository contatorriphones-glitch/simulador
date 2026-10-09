/**
 * Google Agenda da loja: recebe os agendamentos da Bia e cria os eventos.
 * Como instalar: veja LEIA-ME.md nesta pasta.
 */

// Nome da agenda onde os eventos vão aparecer (é criada sozinha se não existir).
const NOME_AGENDA = 'Agendamentos Kronos Phone';

// Senha combinada com a página da Bia (⚙️ > Senha do Apps Script). Troque por uma sua.
const SEGREDO = 'troque-esta-senha';

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.segredo !== SEGREDO) return resposta({ ok: false, erro: 'senha inválida' });

    const agenda = CalendarApp.getCalendarsByName(NOME_AGENDA)[0] || CalendarApp.createCalendar(NOME_AGENDA);
    const [ano, mes, dia] = d.data.split('-').map(Number);
    const [hora, minuto] = d.horario.split(':').map(Number);
    const inicio = new Date(ano, mes - 1, dia, hora, minuto);
    const fim = new Date(inicio.getTime() + (d.duracao_min || 30) * 60 * 1000);

    const evento = agenda.createEvent(d.titulo, inicio, fim, { description: d.descricao, location: d.local });
    evento.addPopupReminder(60);
    evento.addPopupReminder(15);
    return resposta({ ok: true, id: evento.getId() });
  } catch (erro) {
    return resposta({ ok: false, erro: String(erro) });
  }
}

function resposta(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Para testar dentro do editor do Apps Script (botão "Executar" com esta função selecionada).
function testar() {
  const r = doPost({ postData: { contents: JSON.stringify({
    segredo: SEGREDO, titulo: 'Teste da Bia', descricao: 'Evento de teste', local: 'Loja',
    data: Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd'), horario: '18:00', duracao_min: 30,
  }) } });
  Logger.log(r.getContent());
}
