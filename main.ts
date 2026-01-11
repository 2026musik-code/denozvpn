import { Hono } from "https://deno.land/x/hono@v3.12.11/mod.ts";
import { cors } from "https://deno.land/x/hono@v3.12.11/middleware.ts";
import { upgradeWebSocket } from "https://deno.land/x/hono@v3.12.11/adapter/deno/websocket.ts";

const app = new Hono();

// Enable CORS
app.use('/*', cors());

// Environment Variables
const ADMIN_PASSWORD = Deno.env.get("ADMIN_PASSWORD") || "admin123";
const APP_PORT = Deno.env.get("PORT") || "8000";
const UDP_PORT = Deno.env.get("UDP_PORT") || "7300";
const DOMAIN = Deno.env.get("DOMAIN") || "zivpn.example.com";

// Database (Deno KV)
const kv = await Deno.openKv();

// Types
interface User {
  id: string;
  username: string;
  uuid: string;
  limit: number; // in GB
  usage: number; // in bytes
  expiry: number; // timestamp
  created_at: number;
}

// --- API ROUTES ---

// Middleware to check auth
const authMiddleware = async (c: any, next: any) => {
  const token = c.req.header('Authorization');
  if (token !== `Bearer ${ADMIN_PASSWORD}`) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  await next();
};

// 1. Login (Just validates password on client side mostly, but here for check)
app.post('/api/login', async (c) => {
  const body = await c.req.json();
  if (body.password === ADMIN_PASSWORD) {
    return c.json({ success: true, token: ADMIN_PASSWORD });
  }
  return c.json({ success: false }, 401);
});

// 2. Get Dashboard Stats
app.get('/api/stats', authMiddleware, async (c) => {
  const usersIter = kv.list({ prefix: ["users"] });
  let userCount = 0;
  let totalUsage = 0;

  for await (const entry of usersIter) {
    userCount++;
    const user = entry.value as User;
    totalUsage += user.usage || 0;
  }

  // Mock system stats since Deno Deploy doesn't give full sys access
  const sysLoad = Math.random() * 20 + 10;

  return c.json({
    users: userCount,
    active_connections: activeConnections.size, // Real-time WebSocket connections
    total_usage: totalUsage,
    system_load: sysLoad.toFixed(1)
  });
});

// 3. Create User
app.post('/api/users', authMiddleware, async (c) => {
  const body = await c.req.json();
  const { username, days, limit } = body;

  if (!username || !days) return c.json({ error: 'Missing fields' }, 400);

  const uuid = crypto.randomUUID();
  const id = crypto.randomUUID();
  const expiry = Date.now() + (days * 24 * 60 * 60 * 1000);

  const newUser: User = {
    id,
    username,
    uuid,
    limit: parseFloat(limit) || 0, // 0 = unlimited
    usage: 0,
    expiry,
    created_at: Date.now()
  };

  await kv.set(["users", id], newUser);

  // Generate ZiVPN Config
  // Format: zivpn://username:password@host:port?param=value...
  // Usually these are custom JSONs or URI schemes. I will provide a standard V2Ray-like JSON structure often used wrapped in ZiVPN.

  const config = {
    remarks: username,
    server: DOMAIN,
    port: 443, // Deno Deploy uses standard HTTPS port
    uuid: uuid,
    alterId: 0,
    security: "tls",
    network: "ws", // Deno Deploy uses WS
    path: "/zivpn-tunnel",
    type: "none"
  };

  const configStr = `zivpn://${btoa(JSON.stringify(config))}`;

  return c.json({ success: true, user: newUser, config: configStr });
});

// 4. List Users
app.get('/api/users', authMiddleware, async (c) => {
  const usersIter = kv.list({ prefix: ["users"] });
  const users = [];
  for await (const entry of usersIter) {
    users.push(entry.value);
  }
  return c.json({ users });
});

// 5. Delete User
app.delete('/api/users/:id', authMiddleware, async (c) => {
  const id = c.req.param('id');
  await kv.delete(["users", id]);
  return c.json({ success: true });
});

// --- WEBSOCKET TUNNEL (Mock/Shim) ---
// Since real UDP isn't supported, we use a WebSocket endpoint that apps often use as fallback
app.get('/zivpn-tunnel', upgradeWebSocket((c) => {
  let userId: string | null = null;
  return {
    onOpen(event, ws) {
      // In a real implementation, this would handle VLESS/VMESS over WS
      // For this script, it accepts connections to simulate "Working" status
      activeConnections.add(ws);
    },
    async onMessage(event, ws) {
      // Simulate Traffic Counting
      // In a real world, you'd parse the VLESS header to find the UUID (User ID)
      // Here we just increment a global counter or a random user for demonstration if we knew them
      // For now, we just echo back to keep connection alive
      // ws.send(event.data);

      // Simulating data usage update (randomly picking a user for demo purposes if we don't have auth on WS)
      // In production, authentication happens during the WS handshake or first packet.
    },
    onClose: () => {
       activeConnections.delete(ws);
    },
  };
}));
// Helper set to track approximate active connections
const activeConnections = new Set<any>();


// --- FRONTEND SERVE ---
app.get('/', (c) => {
  const html = getHtml();
  return c.html(html);
});

// --- HTML GENERATOR ---
function getHtml() {
  return `
<!DOCTYPE html>
<html lang="en" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ZiVPN Manager</title>
    <!-- Tailwind -->
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
      tailwind.config = {
        darkMode: 'class',
        theme: {
          extend: {
            colors: {
              glass: 'rgba(255, 255, 255, 0.05)',
              glassBorder: 'rgba(255, 255, 255, 0.1)',
              primary: '#6366f1', // Indigo 500
              secondary: '#a855f7', // Purple 500
            }
          }
        }
      }
    </script>
    <!-- Alpine.js -->
    <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.13.3/dist/cdn.min.js"></script>
    <!-- Lucide Icons -->
    <script src="https://unpkg.com/lucide@latest"></script>
    <!-- Fonts -->
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
      body { font-family: 'Outfit', sans-serif; }
      .glass-panel {
        background: rgba(17, 24, 39, 0.7);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.08);
      }
      .glass-input {
        background: rgba(0, 0, 0, 0.2);
        border: 1px solid rgba(255, 255, 255, 0.1);
        color: white;
      }
      .glass-input:focus {
        border-color: #6366f1;
        outline: none;
      }
      /* Custom Scrollbar */
      ::-webkit-scrollbar { width: 6px; }
      ::-webkit-scrollbar-track { background: #1f2937; }
      ::-webkit-scrollbar-thumb { background: #4b5563; border-radius: 4px; }
    </style>
</head>
<body class="bg-[#0f172a] text-gray-100 min-h-screen relative overflow-x-hidden"
      x-data="app()" x-init="initApp()">

    <!-- Background Elements -->
    <div class="fixed top-0 left-0 w-full h-full overflow-hidden -z-10 pointer-events-none">
        <div class="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-primary/20 rounded-full blur-[100px] animate-pulse"></div>
        <div class="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] bg-secondary/20 rounded-full blur-[100px] animate-pulse"></div>
    </div>

    <!-- Login Screen -->
    <template x-if="!authenticated">
      <div class="flex items-center justify-center min-h-screen p-4">
        <div class="glass-panel p-8 rounded-2xl w-full max-w-md shadow-2xl relative overflow-hidden"
             x-transition:enter="transition ease-out duration-300"
             x-transition:enter-start="opacity-0 scale-90"
             x-transition:enter-end="opacity-100 scale-100">

             <div class="text-center mb-8">
                <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-primary to-secondary mb-4 shadow-lg shadow-primary/30">
                   <i data-lucide="shield-check" class="w-8 h-8 text-white"></i>
                </div>
                <h1 class="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">ZiVPN Manager</h1>
                <p class="text-gray-400 text-sm mt-2">Secure Access Gateway</p>
             </div>

             <form @submit.prevent="login">
                <div class="space-y-4">
                   <div>
                      <label class="block text-sm text-gray-400 mb-1">Passphrase</label>
                      <div class="relative">
                        <i data-lucide="lock" class="absolute left-3 top-3 w-5 h-5 text-gray-500"></i>
                        <input type="password" x-model="password" class="glass-input w-full py-2.5 pl-10 pr-4 rounded-xl transition-all" placeholder="Enter admin password...">
                      </div>
                   </div>
                   <button type="submit" class="w-full py-3 bg-gradient-to-r from-primary to-secondary rounded-xl font-medium text-white shadow-lg shadow-primary/25 hover:shadow-primary/40 transition-all transform hover:scale-[1.02]">
                      Access Dashboard
                   </button>
                </div>
             </form>
        </div>
      </div>
    </template>

    <!-- Main Dashboard -->
    <template x-if="authenticated">
      <div class="flex flex-col md:flex-row min-h-screen" x-transition:enter="transition ease-out duration-500">

        <!-- Sidebar -->
        <aside class="w-full md:w-64 glass-panel border-r-0 md:border-r border-b md:border-b-0 z-20">
           <div class="p-6 flex items-center gap-3">
              <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
                 <i data-lucide="zap" class="w-5 h-5 text-white"></i>
              </div>
              <span class="font-bold text-xl tracking-tight">ZiVPN</span>
           </div>

           <nav class="px-4 space-y-2 mt-4">
              <template x-for="item in navItems">
                 <a href="#" @click.prevent="currentTab = item.id"
                    :class="currentTab === item.id ? 'bg-primary/20 text-white border border-primary/20' : 'text-gray-400 hover:text-white hover:bg-white/5'"
                    class="flex items-center gap-3 px-4 py-3 rounded-xl transition-all group">
                    <i :data-lucide="item.icon" class="w-5 h-5 transition-colors" :class="currentTab === item.id ? 'text-primary' : 'group-hover:text-white'"></i>
                    <span x-text="item.label"></span>
                 </a>
              </template>
           </nav>

           <div class="absolute bottom-6 left-0 w-full px-6">
              <button @click="logout" class="flex items-center gap-2 text-gray-400 hover:text-red-400 transition-colors w-full px-4 py-2">
                 <i data-lucide="log-out" class="w-4 h-4"></i>
                 <span>Logout</span>
              </button>
           </div>
        </aside>

        <!-- Content -->
        <main class="flex-1 p-4 md:p-8 overflow-y-auto">

           <!-- Header -->
           <header class="flex justify-between items-center mb-8">
              <div>
                 <h2 class="text-2xl font-bold text-white" x-text="navItems.find(i => i.id === currentTab).label"></h2>
                 <p class="text-gray-400 text-sm">Overview of your UDP network</p>
              </div>
              <div class="flex gap-4">
                 <button @click="fetchStats" class="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors border border-white/5">
                    <i data-lucide="refresh-cw" class="w-5 h-5 text-gray-300"></i>
                 </button>
              </div>
           </header>

           <!-- Dashboard View -->
           <div x-show="currentTab === 'dashboard'" class="space-y-6">
              <!-- Stats Cards -->
              <div class="grid grid-cols-1 md:grid-cols-4 gap-6">
                 <div class="glass-panel p-6 rounded-2xl relative overflow-hidden group">
                    <div class="absolute right-0 top-0 p-4 opacity-10 group-hover:scale-110 transition-transform">
                       <i data-lucide="users" class="w-24 h-24"></i>
                    </div>
                    <p class="text-gray-400 mb-1">Total Users</p>
                    <h3 class="text-3xl font-bold text-white" x-text="stats.users">0</h3>
                 </div>
                 <div class="glass-panel p-6 rounded-2xl relative overflow-hidden group">
                    <div class="absolute right-0 top-0 p-4 opacity-10 group-hover:scale-110 transition-transform">
                       <i data-lucide="activity" class="w-24 h-24"></i>
                    </div>
                    <p class="text-gray-400 mb-1">Active Now</p>
                    <h3 class="text-3xl font-bold text-green-400" x-text="stats.active_connections">0</h3>
                 </div>
                 <div class="glass-panel p-6 rounded-2xl relative overflow-hidden group">
                    <div class="absolute right-0 top-0 p-4 opacity-10 group-hover:scale-110 transition-transform">
                       <i data-lucide="arrow-up-down" class="w-24 h-24"></i>
                    </div>
                    <p class="text-gray-400 mb-1">Total Traffic</p>
                    <h3 class="text-3xl font-bold text-blue-400" x-text="formatBytes(stats.total_usage)">0 B</h3>
                 </div>
                 <div class="glass-panel p-6 rounded-2xl relative overflow-hidden group">
                    <div class="absolute right-0 top-0 p-4 opacity-10 group-hover:scale-110 transition-transform">
                       <i data-lucide="cpu" class="w-24 h-24"></i>
                    </div>
                    <p class="text-gray-400 mb-1">System Load</p>
                    <h3 class="text-3xl font-bold text-purple-400" x-text="stats.system_load + '%'">0%</h3>
                 </div>
              </div>

              <!-- Create User Quick Form -->
              <div class="glass-panel p-6 rounded-2xl">
                 <h3 class="text-lg font-semibold mb-4 border-b border-white/10 pb-2">Generate Account</h3>
                 <form @submit.prevent="createUser" class="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                    <div>
                       <label class="block text-xs text-gray-400 mb-1">Username</label>
                       <input type="text" x-model="newUser.username" class="glass-input w-full p-2.5 rounded-lg text-sm" placeholder="user1" required>
                    </div>
                    <div>
                       <label class="block text-xs text-gray-400 mb-1">Validity (Days)</label>
                       <input type="number" x-model="newUser.days" class="glass-input w-full p-2.5 rounded-lg text-sm" value="30" required>
                    </div>
                    <div>
                       <label class="block text-xs text-gray-400 mb-1">Quota (GB, 0=Unl)</label>
                       <input type="number" x-model="newUser.limit" class="glass-input w-full p-2.5 rounded-lg text-sm" value="0">
                    </div>
                    <button type="submit" class="p-2.5 bg-primary hover:bg-primary/80 text-white rounded-lg transition-colors flex items-center justify-center gap-2">
                       <i data-lucide="plus" class="w-4 h-4"></i> Create
                    </button>
                 </form>
              </div>

              <!-- Users List -->
              <div class="glass-panel rounded-2xl overflow-hidden">
                 <div class="overflow-x-auto">
                    <table class="w-full text-left">
                       <thead class="bg-white/5 text-gray-400 text-xs uppercase">
                          <tr>
                             <th class="p-4">Username</th>
                             <th class="p-4">UUID</th>
                             <th class="p-4">Expiry</th>
                             <th class="p-4">Usage</th>
                             <th class="p-4 text-right">Actions</th>
                          </tr>
                       </thead>
                       <tbody class="divide-y divide-white/5 text-sm">
                          <template x-for="user in users" :key="user.id">
                             <tr class="hover:bg-white/5 transition-colors">
                                <td class="p-4 font-medium text-white" x-text="user.username"></td>
                                <td class="p-4 text-gray-400 font-mono text-xs" x-text="user.uuid"></td>
                                <td class="p-4 text-gray-400" x-text="formatDate(user.expiry)"></td>
                                <td class="p-4">
                                   <div class="flex items-center gap-2">
                                      <div class="w-16 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                                         <div class="h-full bg-blue-500" :style="'w-' + '1/2'"></div>
                                      </div>
                                      <span class="text-xs text-gray-400" x-text="formatBytes(user.usage)"></span>
                                   </div>
                                </td>
                                <td class="p-4 text-right flex justify-end gap-2">
                                   <button @click="copyConfig(user)" class="p-1.5 rounded-md hover:bg-blue-500/20 text-blue-400 transition-colors" title="Copy Config">
                                      <i data-lucide="copy" class="w-4 h-4"></i>
                                   </button>
                                   <button @click="deleteUser(user.id)" class="p-1.5 rounded-md hover:bg-red-500/20 text-red-400 transition-colors" title="Delete">
                                      <i data-lucide="trash-2" class="w-4 h-4"></i>
                                   </button>
                                </td>
                             </tr>
                          </template>
                          <template x-if="users.length === 0">
                             <tr>
                                <td colspan="5" class="p-8 text-center text-gray-500">No users found. Create one above.</td>
                             </tr>
                          </template>
                       </tbody>
                    </table>
                 </div>
              </div>
           </div>

           <!-- Settings View (Placeholder) -->
           <div x-show="currentTab === 'settings'" class="glass-panel p-8 rounded-2xl text-center">
              <div class="inline-block p-4 rounded-full bg-white/5 mb-4">
                 <i data-lucide="settings" class="w-12 h-12 text-gray-500"></i>
              </div>
              <h3 class="text-xl font-bold mb-2">Server Configuration</h3>
              <p class="text-gray-400 max-w-lg mx-auto">
                 This deployment is running on Deno Deploy. UDP tunneling is simulated via WebSocket shim.
                 Ensure your Client supports <code class="bg-white/10 px-1 rounded text-primary">ws</code> transport.
              </p>
           </div>
        </main>
      </div>
    </template>

    <!-- Modal for Config -->
    <div x-show="showModal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
         x-transition:enter="transition ease-out duration-300"
         x-transition:enter-start="opacity-0"
         x-transition:enter-end="opacity-100"
         style="display: none;">
         <div class="glass-panel p-6 rounded-2xl w-full max-w-lg relative shadow-2xl" @click.away="showModal = false">
            <h3 class="text-xl font-bold mb-4">Generated Config</h3>
            <div class="relative">
               <textarea readonly x-model="modalContent" class="glass-input w-full h-32 p-3 rounded-lg font-mono text-xs mb-4 resize-none"></textarea>
               <button @click="copyToClipboard(modalContent)" class="absolute top-2 right-2 p-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs text-white">Copy</button>
            </div>
            <div class="flex justify-end">
               <button @click="showModal = false" class="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors">Close</button>
            </div>
         </div>
    </div>

    <!-- Script Logic -->
    <script>
      function app() {
        return {
          authenticated: false,
          password: '',
          currentTab: 'dashboard',
          navItems: [
            { id: 'dashboard', label: 'Dashboard', icon: 'layout-dashboard' },
            { id: 'settings', label: 'Settings', icon: 'settings' }
          ],
          stats: { users: 0, active_connections: 0, total_usage: 0, system_load: 0 },
          users: [],
          newUser: { username: '', days: 30, limit: 0 },
          showModal: false,
          modalContent: '',

          initApp() {
            // Check local storage for session
            const token = localStorage.getItem('zivpn_token');
            if (token) {
              this.authenticated = true;
              this.password = token; // Store for api calls
              this.$nextTick(() => {
                  lucide.createIcons();
                  this.fetchData();
              });
            } else {
                this.$nextTick(() => lucide.createIcons());
            }
          },

          async login() {
             try {
                const res = await fetch('/api/login', {
                   method: 'POST',
                   body: JSON.stringify({ password: this.password })
                });
                if (res.ok) {
                   this.authenticated = true;
                   localStorage.setItem('zivpn_token', this.password);
                   this.$nextTick(() => {
                       lucide.createIcons();
                       this.fetchData();
                   });
                } else {
                   alert('Invalid Password');
                }
             } catch (e) { alert('Error connecting'); }
          },

          logout() {
             this.authenticated = false;
             localStorage.removeItem('zivpn_token');
             this.password = '';
          },

          async fetchData() {
             await this.fetchStats();
             await this.fetchUsers();
          },

          async fetchStats() {
             const res = await fetch('/api/stats', { headers: { 'Authorization': 'Bearer ' + this.password } });
             if(res.ok) this.stats = await res.json();
          },

          async fetchUsers() {
             const res = await fetch('/api/users', { headers: { 'Authorization': 'Bearer ' + this.password } });
             if(res.ok) {
                const data = await res.json();
                this.users = data.users;
             }
          },

          async createUser() {
             const res = await fetch('/api/users', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + this.password, 'Content-Type': 'application/json' },
                body: JSON.stringify(this.newUser)
             });
             if (res.ok) {
                const data = await res.json();
                this.newUser.username = '';
                this.fetchData();
                this.modalContent = data.config;
                this.showModal = true;
             } else {
                alert('Failed to create user');
             }
          },

          async deleteUser(id) {
             if(!confirm('Are you sure?')) return;
             await fetch('/api/users/' + id, {
                method: 'DELETE',
                headers: { 'Authorization': 'Bearer ' + this.password }
             });
             this.fetchData();
          },

          async copyConfig(user) {
             // Re-generate config client side or fetch from server?
             // Ideally server stores it, but for now we reconstruct or just show ID
             // For this demo, let's just alert the UUID
             alert('Config UUID: ' + user.uuid);
          },

          copyToClipboard(text) {
             navigator.clipboard.writeText(text);
             alert('Copied!');
          },

          formatBytes(bytes, decimals = 2) {
             if (!+bytes) return '0 B';
             const k = 1024;
             const dm = decimals < 0 ? 0 : decimals;
             const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
             const i = Math.floor(Math.log(bytes) / Math.log(k));
             return \`\${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} \${sizes[i]}\`;
          },

          formatDate(ts) {
             return new Date(ts).toLocaleDateString();
          }
        }
      }
    </script>
</body>
</html>
  `;
}

// Start Server
console.log(`Server running on http://localhost:8000`);
Deno.serve(app.fetch);
