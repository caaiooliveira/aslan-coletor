# Coletor da Bigo no GitHub (grátis, sem deixar o computador ligado)

O GitHub roda o coletor sozinho a cada 5 minutos e atende o botão "Consultar agora" (resposta em cerca de 10 segundos enquanto a rodada estiver ativa).

## Passo a passo
1. Crie uma conta em github.com (se ainda não tiver) e clique em **New repository**. Nome: `aslan-coletor`. Marque **Public** (repositório público tem minutos grátis ilimitados; o privado só tem 2.000 min/mês, que não bastam). Não marque README.
2. Suba o **conteúdo desta pasta** (src, test, package.json, package-lock.json, .gitignore, .env.example e a pasta oculta `.github`) para o repositório: na página do repositório vazio, clique em **uploading an existing file** e arraste tudo. Atenção: a pasta `.github` precisa ir junto (no Windows ela pode estar oculta: Exibir → Itens ocultos).
   **Nunca suba um arquivo `.env`.** As chaves ficam nos Secrets (passo 3), não no código.
3. No repositório: **Settings → Secrets and variables → Actions → New repository secret**. Crie dois:
   - `SUPABASE_URL` = o endereço do projeto (https://xxxx.supabase.co)
   - `SUPABASE_SERVICE_ROLE_KEY` = a chave **service_role** (Supabase → Project Settings → API). Ela é secreta: só cole aqui.
4. Aba **Actions** → se pedir, clique em "I understand my workflows, enable them". Abra **Coletor Bigo** → **Run workflow** para testar. Em cerca de 1 a 2 minutos deve ficar verde, e o log mostra "lidos N em Xs".
5. Pronto: a partir daí ele roda sozinho a cada 5 minutos.

## Bom saber
- O GitHub pode atrasar os agendamentos em alguns minutos nos horários de pico.
- Se ninguém mexer no repositório por 60 dias, o GitHub pausa os agendamentos: basta abrir a aba Actions e reativar (ou fazer qualquer pequena alteração).
- Se aparecer erro de leitura em todos os IDs, a Bigo pode estar bloqueando os servidores do GitHub. Nesse caso use o coletor no seu computador (`npm start`), que já foi testado: leu 7898 beans do ID 129896171.
- Se você ligou a leitura pelo Supabase (script 12), desligue-a para não duplicar.
