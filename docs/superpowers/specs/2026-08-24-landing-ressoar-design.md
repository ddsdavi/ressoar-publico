# Landing page da Ressoar — design

Data: 2026-08-24. Pedido: uma página inicial pública para o domínio do painel,
com a estrutura e o tom da landing da Ressoa, o visual-farol da página
`activecampaign.com/br/lp/brand` e a identidade própria da Ressoar.

## O que ela é

A página que um visitante vê na raiz do domínio — hoje ele cai direto na tela
de login. O visitante mais comum não é a equipe: é quem recebeu um e-mail
enviado pela plataforma, olhou o domínio do link e veio ver o que é isto.
A página cumpre três papéis:

1. **Explicar a plataforma** — o que é, o que faz, por que existe (a página
   `/lp/brand` do ActiveCampaign faz exatamente isso para quem percebe a marca
   deles num e-mail; é o farol declarado deste trabalho).
2. **Dar transparência a quem recebe** — por que recebo, como paro de receber,
   onde ficam meus dados.
3. **Levar a equipe à área de trabalho** — botão Entrar no cabeçalho, como o
   "Minha área" da Ressoa.

## Rotas (mexe só no Portão do App.tsx)

| Rota | Sem sessão | Com sessão |
|---|---|---|
| `/` | **Landing** (antes: tela de login) | painel, como sempre |
| `/entrar` | tela de login | redireciona para `/` |
| `/inicio` | Landing | Landing (para rever a página logado) |
| `/f/:slug` | formulário público (intocado) | intocado |
| demais | tela de login (como hoje) | painel |

Deep link protegido continua caindo no login — nada quebra para a equipe.

## Identidade

- Paleta e tipografia do painel: roxo `#82308F`, escuro `#170020`, lilases
  `#C77FD6`/`#F3E5F7`, IBM Plex Sans (já auto-hospedada via
  `@fontsource/ibm-plex-sans` no main.tsx — a landing herda).
- As **ondas de ressonância** da tela de login (animação `pulsoRessoar`) são a
  assinatura visual e aparecem no herói e no fechamento.
- Do ActiveCampaign: cabeçalho escuro com Entrar, herói escuro com uma
  mini-tela viva do produto, cartões de estatística com números gigantes,
  recursos alternando texto e mini-tela, FAQ, faixa final de chamada.
- Da Ressoa: a ordem das seções, o tom honesto, a seção "Onde tudo começou",
  os passos numerados e o rodapé em colunas.

## Estrutura da página

1. Cabeçalho fixo: logo, âncoras (A plataforma · Como funciona · Recebeu um
   e-mail? · Perguntas), Entrar / Minha área.
2. Herói: pílula, título, subtítulo, dois botões, microcópia, link para a
   seção de transparência; à direita, mini-tela do motor com eventos reais
   (`lista_inscrita`, `tag_adicionada`…) pulsando.
3. Quatro cartões de estatística (números da operação que não envelhecem:
   13 mil+ leads migrados, 15 automações, R$ 0 por contato, 100% dos dados
   em casa).
4. A plataforma: seis recursos com mini-telas (campanhas e mensagens,
   automações, base de leads, vendas e atribuição, formulários, WhatsApp).
5. Onde tudo começou: a história da mudança de aluguel para casa própria,
   com linha do tempo da migração.
6. Como funciona: quatro passos (o lead chega → o motor reage → a campanha
   sai → o resultado volta).
7. Recebeu um e-mail?: três cartões de transparência.
8. Perguntas que todo mundo faz: seis perguntas em `<details>`.
9. Faixa final: chamada para a equipe entrar.
10. Rodapé: colunas (Ressoar / Acesso / Projeto, com o espelho público no
    GitHub), assinatura e aviso de privacidade curto.

## Regras que a página respeita

- **Nome de ninguém no código** (regra do espelho público): menções à dona da
  conta saem de `VITE_MARCA_NOME` (lib/marca), com texto que funciona vazio.
- Sem números voláteis: estatísticas com "+" ou fatos da migração.
- Sem exclamações, sem promessa vazia; a página só afirma o que o painel faz.
- Tema escuro do painel respeitado: as seções claras usam os tokens `--ac-*`,
  que já mudam com `html.tema-escuro`; o herói é escuro nos dois temas.
- CSS todo prefixado `lp-` num arquivo próprio, para não vazar para o painel.
- `prefers-reduced-motion` desliga ondas, pulsos e a digitação.

## Arquivos

- `app/painel/src/pages/Landing.tsx` — a página.
- `app/painel/src/landing.css` — estilos dela (importado só por ela).
- `app/painel/src/App.tsx` — as três linhas de rota no Portão.
- `app/painel/index.html` — meta description + IBM Plex Sans.

Publicação: `npm --prefix app/painel run build` e
`npx wrangler pages deploy app/painel/dist --project-name ressoar` (o mesmo
caminho do instalador).
