/**
 * Notion Account info extraction script (legacy manual fallback)
 *
 * 推荐优先运行 `python login.py`。This login helper opens a temporary Chrome/Edge
 * debug console and extract token_v2 plus account/workspace fields from the browser session.
 *
 * If the automated login flow is unavailable, use this manual script:
 * 1. Browser login https://www.notion.so/ai
 * 2. Make sure the top-left account switcher is the account you want
 * 3. F12 → Application → Cookies → Copy the token_v2 value
 * 4. F12 → Console → 粘贴本脚本 → 回车
 * 5. If multiple accounts/workspaces, pick as prompted
 * 6. Paste the output JSON into accounts.json，Replace YOUR_TOKEN_V2
 */
(async () => {
  try {
    // ─── Step 1: fetch all accessible users and spaces ───
    // getSpaces Returns all users visible to the current token (multi-account)
    let allUsers = {};  // user_id → {name, email}
    let allSpaces = {}; // space_id → {name, plan, members}
    let spaceViewMap = {}; // space_id → space_view_id

    // Try getSpaces (richer multi-account data)
    try {
      const r1 = await fetch('/api/v3/getSpaces', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: '{}', credentials: 'include'
      });
      const d1 = await r1.json();
      // getSpaces 返回 { "user_id_1": { space: {...}, ... }, "user_id_2": {...} }
      if (d1 && typeof d1 === 'object' && !d1.recordMap) {
        for (const [userId, userData] of Object.entries(d1)) {
          if (!userData || typeof userData !== 'object') continue;
          // 提取User信息
          const nu = userData.notion_user;
          if (nu) {
            for (const [nuid, nuData] of Object.entries(nu)) {
              const v = nuData?.value?.value || nuData?.value || nuData || {};
              allUsers[nuid] = {
                name: v.given_name || v.name || v.family_name || '',
                email: v.email || ''
              };
            }
          }
          // 提取空间信息
          const sp = userData.space;
          if (sp) {
            for (const [sid, sData] of Object.entries(sp)) {
              const v = sData?.value?.value || sData?.value || sData || {};
              if (!allSpaces[sid]) {
                allSpaces[sid] = {
                  name: v.name || '',
                  plan: v.plan_type || v.subscription_tier || ''
                };
              }
            }
          }
          // Extract space_view
          const sv = userData.space_view;
          if (sv) {
            for (const [svid, svData] of Object.entries(sv)) {
              const v = svData?.value?.value || svData?.value || svData || {};
              if (v.space_id) spaceViewMap[v.space_id] = svid;
            }
          }
        }
      }
    } catch (e) { /* getSpaces failed; fall back to loadUserContent */ }

    // fallback：loadUserContent
    const r2 = await fetch('/api/v3/loadUserContent', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: '{}', credentials: 'include'
    });
    const d2 = (await r2.json()).recordMap || {};

    // 合并User
    for (const [nuid, nuData] of Object.entries(d2.notion_user || {})) {
      if (allUsers[nuid]) continue;
      const v = nuData?.value?.value || nuData?.value || nuData || {};
      allUsers[nuid] = {
        name: v.given_name || v.name || v.family_name || '',
        email: v.email || ''
      };
    }
    // 合并空间
    for (const [sid, sData] of Object.entries(d2.space || {})) {
      if (allSpaces[sid]) continue;
      const v = sData?.value?.value || sData?.value || sData || {};
      allSpaces[sid] = {
        name: v.name || '',
        plan: v.plan_type || v.subscription_tier || ''
      };
    }
    // Merge space_view
    for (const [svid, svData] of Object.entries(d2.space_view || {})) {
      const v = svData?.value?.value || svData?.value || svData || {};
      if (v.space_id && !spaceViewMap[v.space_id]) spaceViewMap[v.space_id] = svid;
    }

    // Read notion_user_id from cookies (active UI account)
    const cookieUserId = document.cookie.split(';')
      .map(c => c.trim())
      .find(c => c.startsWith('notion_user_id='))
      ?.split('=')[1] || '';

    const userList = Object.entries(allUsers);
    const spaceList = Object.entries(allSpaces).map(([id, s]) => ({
      space_id: id, name: s.name, plan: s.plan, space_view_id: spaceViewMap[id] || ''
    }));

    if (userList.length === 0) {
      console.error('❌ No user info found; confirm you are logged into Notion');
      return;
    }

    // ─── 展示 & 选择User ───
    console.log('\n');
    console.log('%c═══════════════════════════════════════════════', 'color:#00a699');
    console.log('%c  Notion account extractor', 'font-size:15px;font-weight:bold;color:#00a699');
    console.log('%c═══════════════════════════════════════════════', 'color:#00a699');
    console.log('');

    let chosenUserId, chosenUserName, chosenUserEmail;

    if (userList.length === 1) {
      chosenUserId = userList[0][0];
      chosenUserName = userList[0][1].name;
      chosenUserEmail = userList[0][1].email;
      console.log(`%c👤 User: ${chosenUserName || '(unknown)'} ${chosenUserEmail ? '(' + chosenUserEmail + ')' : ''}`, 'font-size:13px');
    } else {
      console.log(`%c👥 检测到 ${userList.length}  Notion accounts:`, 'font-size:13px;font-weight:bold');
      console.log('');
      userList.forEach(([uid, u], i) => {
        const active = uid === cookieUserId ? ' ← active' : '';
        console.log(`%c  [${i}]  ${u.name || '(unknown)'} ${u.email ? '(' + u.email + ')' : ''}${active}`, 'font-size:13px');
      });
      console.log('');
      console.log('%c👆 See the account list above; picker in 3s...', 'color:#ff9800;font-size:12px');

      await new Promise(resolve => setTimeout(resolve, 3000));

      const promptText = userList.map(([uid, u], i) => {
        const active = uid === cookieUserId ? ' ← current' : '';
        return `[${i}] ${u.name || '(unknown)'} ${u.email ? '(' + u.email + ')' : ''}${active}`;
      }).join('\n');

      const idx = prompt(`Select the account to extract:\n\n${promptText}\n\nEnter index (0 ~ ${userList.length - 1})：`);
      if (idx === null || idx.trim() === '') {
        console.log('%c⚠️ Cancelled', 'color:#ff9800');
        return;
      }
      const chosen = userList[parseInt(idx)];
      if (!chosen) {
        console.error(`❌ 编号 "${idx}" 无效`);
        return;
      }
      chosenUserId = chosen[0];
      chosenUserName = chosen[1].name;
      chosenUserEmail = chosen[1].email;
    }

    console.log(`%c✅ 选择User: ${chosenUserName || chosenUserId.slice(0,8)} ${chosenUserEmail ? '(' + chosenUserEmail + ')' : ''}`, 'color:#00c853;font-size:13px');

    // ─── 选择工作区 ───
    if (spaceList.length === 0) {
      console.error('❌ No workspaces found');
      return;
    }

    console.log('');
    console.log(`%c📂 找到 ${spaceList.length} 个工作区：`, 'font-size:13px;font-weight:bold');
    console.log('');
    spaceList.forEach((s, i) => {
      const label = s.name || `(ID: ${s.space_id.slice(0, 13)}...)`;
      const planStr = s.plan ? `  计划: ${s.plan}` : '';
      console.log(`%c  [${i}]  ${label}${planStr}`, 'font-size:13px');
    });

    let chosenSpace;
    if (spaceList.length === 1) {
      chosenSpace = spaceList[0];
      console.log('%c🎯 Only one workspace; auto-selected', 'color:#2196f3;font-weight:bold');
    } else {
      console.log('');
      console.log('%c👆 Workspace picker in 3s...', 'color:#ff9800;font-size:12px');
      await new Promise(resolve => setTimeout(resolve, 3000));

      const promptText = spaceList.map((s, i) => {
        const label = s.name || `ID: ${s.space_id.slice(0, 13)}...`;
        return `[${i}] ${label}`;
      }).join('\n');

      const idx = prompt(`Select a workspace with AI enabled:\n\n${promptText}\n\nEnter index (0 ~ ${spaceList.length - 1})：`);
      if (idx === null || idx.trim() === '') {
        console.log('%c⚠️ Cancelled', 'color:#ff9800');
        return;
      }
      chosenSpace = spaceList[parseInt(idx)];
      if (!chosenSpace) {
        console.error(`❌ 编号 "${idx}" 无效`);
        return;
      }
    }

    // ─── 输出结果 ───
    const account = {
      token_v2: 'YOUR_TOKEN_V2',
      space_id: chosenSpace.space_id,
      user_id: chosenUserId,
      space_view_id: chosenSpace.space_view_id,
      user_name: chosenUserName,
      user_email: chosenUserEmail
    };

    const json = JSON.stringify(account, null, 2);
    const spaceLabel = chosenSpace.name || chosenSpace.space_id.slice(0, 13) + '...';

    console.log('');
    console.log('%c═══════════════════════════════════════════════', 'color:#00c853');
    console.log(`%c✅ User: ${chosenUserName || '(unknown)'}  工作区: ${spaceLabel}`, 'color:#00c853;font-weight:bold;font-size:14px');
    console.log('%c═══════════════════════════════════════════════', 'color:#00c853');
    console.log('');
    console.log(json);
    console.log('');
    console.log('%c⚠️  Next: replace YOUR_TOKEN_V2 with the token_v2 you copied', 'color:#ff9800;font-weight:bold');
    console.log('%c   Then paste into the accounts.json array', 'color:#ff9800');
    console.log('%c   ⚠️  Use the token_v2 for the selected account (confirm in Cookies)', 'color:#ff9800');

    setTimeout(() => {
      navigator.clipboard.writeText(json)
        .then(() => console.log('%c📋 Copied to clipboard', 'color:#00c853'))
        .catch(() => console.log('%c📋 Manually select and copy the JSON above', 'color:#ff9800'));
    }, 800);

  } catch (e) { console.error('❌ Extract failed:', e.message) }
})();
