// Quem assina o painel: o nome que aparece na aba do navegador, no rodapé da
// barra lateral e na tela de entrada.
//
// Fica em variável de ambiente, e não no código, porque este repositório tem
// um espelho público — nome e nicho da dona da conta não moram em arquivo
// versionado. Antes ficavam, e a limpeza que os tirou para o espelho acabou
// entrando aqui também: o painel passou a se apresentar como "Ressoar · Nome
// do Remetente" em produção, com cara de campo esquecido.
//
// Sem as variáveis o painel se apresenta só como Ressoar. É o que qualquer
// pessoa que clonar o projeto vai ver — nome de ninguém, e nada parecendo bug.

export const MARCA_NOME = (import.meta.env.VITE_MARCA_NOME ?? "").trim();
export const MARCA_RODAPE = (import.meta.env.VITE_MARCA_RODAPE ?? "").trim();

export const TITULO = MARCA_NOME ? `Ressoar · ${MARCA_NOME}` : "Ressoar";
