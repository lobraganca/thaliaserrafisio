# Dra. Thalia Serra · Fisioterapia

Site com agendamento online e Área Adm, para a fisioterapeuta Thalia Serra (Itabirito/MG).

## Arquivos
- `index.html` — site (landing page)
- `agendar.html` — página de agendamento online (abre em `/agendar`)
- `contato.js` — número do WhatsApp da Thalia
- `admin.html` — Área da Thalia (abre em `/admin` ou `/adm`)
- `api/` — funções da Vercel: `horarios` (horários livres), `agendar` (cria agendamento), `admin` (login e gestão)
- `img/` — fotos

## Para ativar na Vercel (uma vez)
1. **Banco:** na Vercel, abra o projeto → *Storage* → *Create / Connect* → **Upstash for Redis** (plano grátis) e conecte ao projeto.
   Isso cria sozinho as variáveis `KV_REST_API_URL` e `KV_REST_API_TOKEN` (ou use `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`).
2. **Login da Thalia:** em *Settings → Environment Variables*, crie:
   - `ADMIN_USER` = login (ex.: thalia)
   - `ADMIN_PASS` = senha forte
   - `ADMIN_NAME` = Thalia (opcional)
3. Faça um novo deploy. Pronto: o site passa a mostrar os horários reais e a Thalia entra em `/admin`.

**WhatsApp:** coloque o número no arquivo `contato.js` (só dígitos, com 55 + DDD). Vale para o site e para a página de agendamento.
Enquanto estiver vazio, os botões de WhatsApp abrem o Direct do Instagram (@thaliaserra_fisio).

## Como funciona
- Horários padrão: seg–qui 7h–12h e 14h–19h, sex 7h–12h e 14h–18h, sáb 8h–12h, atendimentos de 60 min. A Thalia muda tudo em *Área Adm → Horários e bloqueios*.
- Cada horário só pode ser reservado por uma pessoa (trava atômica no banco).
- Agendamentos do site chegam como **A confirmar**; a Thalia confirma com um toque e manda a mensagem pronta no WhatsApp.
- Cancelar libera o horário no site na hora. Bloqueios fecham um dia inteiro ou um horário.
- Proteções: senha só nas variáveis da Vercel, limite de tentativas de login, limite de agendamentos por internet, campo anti-robô.

Página criada por Lorena Bragança · (31) 97147-3162 · @lo_braganca
