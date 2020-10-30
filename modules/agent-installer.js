/*
Copyright 2020 Intel Corporation

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

Object.defineProperty(Array.prototype, 'getParameter',
    {
        value: function (name, defaultValue)
        {
            var i, ret;
            for (i = 0; i < this.length; ++i)
            {
                if (this[i].startsWith('--' + name + '='))
                {
                    ret = this[i].substring(name.length + 3);
                    if (ret.startsWith('"')) { ret = ret.substring(1, ret.length - 1); }
                    return (ret);
                }
            }
            return (defaultValue);
        }
    });
Object.defineProperty(Array.prototype, 'getParameterIndex',
    {
        value: function (name)
        {
            var i;
            for (i = 0; i < this.length; ++i)
            {
                if (this[i].startsWith('--' + name + '='))
                {
                    return (i);
                }
            }
            return (-1);
        }
    });

function checkParameters(parms)
{
    var msh = _MSH();

    if (parms.getParameter('companyName', null) == null && msh.companyName != null) { parms.push('--companyName="' + msh.companyName + '"'); }
    if (parms.getParameter('meshServiceName', null) == null)
    {
        if(msh.meshServiceName != null)
        {
            parms.push('--meshServiceName="' + msh.meshServiceName + '"');
        }
        else
        {
            // Still no meshServiceName specified... Let's also check installed services...
            var tmp = require('_agentNodeId').serviceName();
            if(tmp != (process.platform == 'win32' ? 'Mesh Agent' : 'meshagent'))
            {
                parms.push('--meshServiceName="' + tmp + '"');
            }
        }
    }
}
function installService(params)
{
    process.stdout.write('...Installing service');
    console.info1('');

    var proxyFile = process.execPath;
    if (process.platform == 'win32')
    {
        proxyFile = proxyFile.split('.exe').join('.proxy');
        try
        {
            params.push('--installedByUser="' + require('win-registry').usernameToUserKey(require('user-sessions').getProcessOwnerName(process.pid).name) + '"');
        }
        catch(exc)
        {
        }
    }
    else
    {
        var u = require('user-sessions').tty();
        var uid = 0;
        try
        {
            uid = require('user-sessions').getUid(u);
        }
        catch(e)
        {
        }
        params.push('--installedByUser=' + uid);
        proxyFile += '.proxy';
    }

    var options =
        {
            name: params.getParameter('meshServiceName', process.platform == 'win32' ? 'Mesh Agent' : 'meshagent'),
            target: process.platform == 'win32' ? 'MeshAgent' : 'meshagent',
            servicePath: process.execPath,
            startType: 'AUTO_START',
            parameters: params,
            _installer: true
        };
    options.displayName = options.name + ' background service';

    if (process.platform == 'win32') { options.companyName = ''; }
    if (require('fs').existsSync(proxyFile)) { options.files = [{ source: proxyFile, newName: options.target + '.proxy' }]; }
    
    var i;
    if ((i = params.indexOf('--copy-msh="1"')) >= 0)
    {
        var mshFile = process.platform == 'win32' ? (process.execPath.split('.exe').join('.msh')) : (process.execPath + '.msh');
        if (options.files == null) { options.files = []; }
        options.files.push({ source: mshFile, newName: options.target + '.msh' });
        options.parameters.splice(i, 1);
    }
    if ((i=params.indexOf('--_localService="1"'))>=0)
    {
        // install in place
        options.parameters.splice(i, 1);
        options.installInPlace = true;
    }

    if (global._workingpath != null && global._workingpath != '' && global._workingpath != '/')
    {
        for (i = 0; i < options.parameters.length; ++i)
        {
            if (options.parameters[i].startsWith('--installPath='))
            {
                global._workingpath = null;
                break;
            }
        }
        if(global._workingpath != null)
        {
            options.parameters.push('--installPath="' + global._workingpath + '"');
        }
    }

    for (i = 0; i < options.parameters.length; ++i)
    {
        if(options.parameters[i].startsWith('--installPath='))
        {
            options.installPath = options.parameters[i].split('=')[1];
            if (options.installPath.startsWith('"')) { options.installPath = options.installPath.substring(1, options.installPath.length - 1); }
            options.parameters.splice(i, 1);
            options.installInPlace = false;
            break;
        }
        if (options.parameters[i].startsWith('--companyName='))
        {
            options.companyName = options.parameters[i].split('=')[1];
            if (options.companyName.startsWith('"')) { options.companyName = options.companyName.substring(1, options.companyName.length - 1); }
            options.parameters.splice(i, 1);
            break;
        }
        if(options.parameters[i].startsWith('--meshServiceName='))
        {

        }
    }
    try
    {
        require('service-manager').manager.installService(options);
        process.stdout.write(' [DONE]\n');
    }
    catch(sie)
    {
        process.stdout.write(' [ERROR] ' + sie);
        process.exit();
    }
    var svc = require('service-manager').manager.getService(options.name);
    if (process.platform == 'darwin')
    {
        svc.load();
        process.stdout.write('   -> setting up launch agent...');
        try
        {
            require('service-manager').manager.installLaunchAgent(
                {
                    name: options.name,
                    servicePath: svc.appLocation(),
                    startType: 'AUTO_START',
                    sessionTypes: ['LoginWindow'],
                    parameters: ['-kvm1']
                });
            process.stdout.write(' [DONE]\n');
        }
        catch (sie)
        {
            process.stdout.write(' [ERROR] ' + sie);
        }
    }


    if(process.platform == 'win32')
    {
        var loc = svc.appLocation();
        process.stdout.write('   -> Writing firewall rules for ' + options.name + ' Service...');

        var rule = 
            {
                DisplayName: options.name + ' Management Traffic (TCP-1)',
                direction: 'inbound',
                Program: loc,
                Protocol: 'TCP',
                Profile: 'Public, Private, Domain',
                LocalPort: 16990,
                Description: 'Mesh Central Agent Management Traffic',
                EdgeTraversalPolicy: 'allow',
                Enabled: true
            };
        require('win-firewall').addFirewallRule(rule);

        rule = 
            {
                DisplayName: options.name + ' Management Traffic (TCP-2)',
                direction: 'inbound',
                Program: loc,
                Protocol: 'TCP',
                Profile: 'Public, Private, Domain',
                LocalPort: 16991,
                Description: 'Mesh Central Agent Management Traffic',
                EdgeTraversalPolicy: 'allow',
                Enabled: true
            };
        require('win-firewall').addFirewallRule(rule); 

        rule =
        {
            DisplayName: options.name + ' Peer-to-Peer Traffic (UDP-1)',
            direction: 'inbound',
            Program: loc,
            Protocol: 'UDP',
            Profile: 'Public, Private, Domain',
            LocalPort: 16990,
            Description: 'Mesh Central Agent Peer-to-Peer Traffic',
            EdgeTraversalPolicy: 'allow',
            Enabled: true
        };
        require('win-firewall').addFirewallRule(rule);

        rule =
            {
                DisplayName: options.name + ' Peer-to-Peer Traffic (UDP-2)',
                direction: 'inbound',
                Program: loc,
                Protocol: 'UDP',
                Profile: 'Public, Private, Domain',
                LocalPort: 16991,
                Description: 'Mesh Central Agent Peer-to-Peer Traffic',
                EdgeTraversalPolicy: 'allow',
                Enabled: true
            };
        require('win-firewall').addFirewallRule(rule);
        process.stdout.write(' [DONE]\n');
    }
    process.stdout.write('   -> Starting service...');
    try
    {
        svc.start();
        process.stdout.write(' [OK]\n');
    }
    catch(ee)
    {
        process.stdout.write(' [ERROR]\n');
    }

    if (process.platform == 'win32') { svc.close(); }
    process.exit();
}

function uninstallService3(params)
{
    if (process.platform == 'darwin')
    {
        process.stdout.write('   -> Uninstalling launch agent...');
        try
        {
            var launchagent = require('service-manager').manager.getLaunchAgent(params.getParameter('meshServiceName', 'meshagent'));
            launchagent.unload();
            require('fs').unlinkSync(launchagent.plist);
            process.stdout.write(' [DONE]\n');
        }
        catch (e)
        {
            process.stdout.write(' [ERROR]\n');
        }
    }
    if (params != null && !params.includes('_stop'))
    {
        installService(params);
    }
    else
    {
        process.exit();
    }
}

function uninstallService2(params, msh)
{
    var secondaryagent = false;
    var i;
    var dataFolder = null;
    var appPrefix = null;
    var uninstallOptions = null;
    var serviceName = params.getParameter('meshServiceName', process.platform == 'win32' ? 'Mesh Agent' : 'meshagent');

    try { require('fs').unlinkSync(msh); } catch (mshe) { }
    if ((i = params.indexOf('__skipBinaryDelete')) >= 0)
    {
        params.splice(i, 1);
        uninstallOptions = { skipDeleteBinary: true };
    }
    if (params && params.includes('--_deleteData="1"'))
    {
        for (i = 0; i < params.length; ++i)
        {
            if (params[i].startsWith('_workingDir='))
            {
                dataFolder = params[i].split('=')[1];
                if (dataFolder.startsWith('"')) { dataFolder = dataFolder.substring(1, dataFolder.length - 1); }
            }
            if (params[i].startsWith('_appPrefix='))
            {
                appPrefix = params[i].split('=')[1];
                if (appPrefix.startsWith('"')) { appPrefix = appPrefix.substring(1, appPrefix.length - 1); }
            }
        }
    }

    process.stdout.write('   -> Uninstalling previous installation...');
    try
    {
        require('service-manager').manager.uninstallService(serviceName, uninstallOptions);
        process.stdout.write(' [DONE]\n');
        if (dataFolder && appPrefix)
        {
            process.stdout.write('   -> Deleting agent data...');
            if (process.platform != 'win32')
            {
                var levelUp = dataFolder.split('/');
                levelUp.pop();
                levelUp = levelUp.join('/');

                var child = require('child_process').execFile('/bin/sh', ['sh']);
                child.stdout.on('data', function (c) { });
                child.stderr.on('data', function (c) { });
                child.stdin.write('cd ' + dataFolder + '\n');
                child.stdin.write('rm ' + appPrefix + '.*\n');
                child.stdin.write('cd /\n');
                child.stdin.write('rmdir ' + dataFolder + '\n');
                child.stdin.write('rmdir ' + levelUp + '\n');
                child.stdin.write('exit\n');       
                child.waitExit();    
            }
            else
            {
                var levelUp = dataFolder.split('\\');
                levelUp.pop();
                levelUp = levelUp.join('\\');
                var child = require('child_process').execFile(process.env['windir'] + '\\system32\\cmd.exe', ['/C del "' + dataFolder + '\\' + appPrefix + '.*" && rmdir "' + dataFolder + '" && rmdir "' + levelUp + '"']);
                child.stdout.on('data', function (c) { });
                child.stderr.on('data', function (c) { });
                child.waitExit();
            }

            process.stdout.write(' [DONE]\n');
        }
    }
    catch (e)
    {
        process.stdout.write(' [ERROR]\n');
    }

    // Check for secondary agent
    try
    {
        process.stdout.write('   -> Checking for secondary agent...');
        var s = require('service-manager').manager.getService(serviceName + 'Diagnostic');
        var loc = s.appLocation();
        s.close();
        process.stdout.write(' [FOUND]\n');
        process.stdout.write('      -> Uninstalling secondary agent...');
        secondaryagent = true;
        try
        {
            require('service-manager').manager.uninstallService(serviceName + 'Diagnostic');
            process.stdout.write(' [DONE]\n');
        }
        catch (e)
        {
            process.stdout.write(' [ERROR]\n');
        }
    }
    catch (e)
    {
        process.stdout.write(' [NONE]\n');
    }

    if(secondaryagent)
    {
        process.stdout.write('      -> removing secondary agent from task scheduler...');
        var p = require('task-scheduler').delete(serviceName + 'Diagnostic/periodicStart');
        p._params = params;
        p.then(function ()
        {
            process.stdout.write(' [DONE]\n');
            uninstallService3(this._params);
        }, function ()
        {
            process.stdout.write(' [ERROR]\n');
            uninstallService3(this._params);
        });
    }
    else
    {
        uninstallService3(params);
    }
}
function uninstallService(params)
{
    var svc = require('service-manager').manager.getService(params.getParameter('meshServiceName', process.platform == 'win32' ? 'Mesh Agent' : 'meshagent'));
    var msh = svc.appLocation();
    if (process.platform == 'win32')
    {
        msh = msh.substring(0, msh.length - 4) + '.msh';
    }
    else
    {
        msh = msh + '.msh';
    }

    if (svc.isRunning == null || svc.isRunning())
    {
        process.stdout.write('   -> Stopping Service...');
        if(process.platform=='win32')
        {
            svc.stop().then(function ()
            {
                process.stdout.write(' [STOPPED]\n');
                svc.close();
                uninstallService2(this._params, msh);
            }, function ()
            {
                process.stdout.write(' [ERROR]\n');
                svc.close();
                uninstallService2(this._params, ms);
            }).parentPromise._params = params;
        }
        else
        {
            if (process.platform == 'darwin')
            {
                svc.unload();
            }
            else
            {
                svc.stop();
            }
            process.stdout.write(' [STOPPED]\n');
            uninstallService2(params, msh);
        }
    }
    else
    {
        if (process.platform == 'win32') { svc.close(); }
        uninstallService2(params, msh);
    }
}
function serviceExists(loc, params)
{
    process.stdout.write(' [FOUND: ' + loc + ']\n');
    if(process.platform == 'win32')
    {
        process.stdout.write('   -> Checking firewall rules for previous installation...');
        require('win-firewall').removeFirewallRule({ program: loc }).then(function ()
        {
            // SUCCESS
            process.stdout.write(' [DELETED]\n');
            uninstallService(this._params);
        }, function ()
        {
            // FAILED
            process.stdout.write(' [No Rules Found]\n');
            uninstallService(this._params);
        }).parentPromise._params = params;
    }
    else
    {
        uninstallService(params);
    }
}

function fullUninstall(jsonString)
{
    console.setDestination(console.Destinations.DISABLED);
    var parms = JSON.parse(jsonString);
    parms.push('_stop');

    checkParameters(parms);

    var name = parms.getParameter('meshServiceName', process.platform == 'win32' ? 'Mesh Agent' : 'meshagent');

    try
    {
        process.stdout.write('...Checking for previous installation of "' + name + '"');
        var s = require('service-manager').manager.getService(name);
        var loc = s.appLocation();
        var appPrefix = loc.split(process.platform == 'win32' ? '\\' : '/').pop();
        if (process.platform == 'win32') { appPrefix = appPrefix.substring(0, appPrefix.length - 4); }

        parms.push('_workingDir=' + s.appWorkingDirectory());
        parms.push('_appPrefix=' + appPrefix);

        s.close();
    }
    catch (e)
    {
        process.stdout.write(' [NONE]\n');
        process.exit();
    }
    serviceExists(loc, parms);
}

function fullInstall(jsonString)
{
    var parms = JSON.parse(jsonString);
    checkParameters(parms);

    var loc = null;
    var i;
    var name = parms.getParameter('meshServiceName', process.platform == 'win32' ? 'Mesh Agent' : 'meshagent');

    if (parseInt(parms.getParameter('verbose', 0)) == 0)
    {
        console.setDestination(console.Destinations.DISABLED);
    }
    else
    {
        console.setInfoLevel(1); 
    }

    try
    {
        process.stdout.write('...Checking for previous installation of "' + name + '"');
        var s = require('service-manager').manager.getService(name);
        loc = s.appLocation();

        global._workingpath = s.appWorkingDirectory();
        console.info1('');
        console.info1('Previous Working Path: ' + global._workingpath);
        s.close();
    }
    catch (e)
    {
        process.stdout.write(' [NONE]\n');
        installService(parms);
        return;
    }
    if (process.execPath == loc)
    {
        parms.push('__skipBinaryDelete');
    }
    serviceExists(loc, parms);
}


module.exports =
    {
        fullInstall: fullInstall,
        fullUninstall: fullUninstall
    };

function sys_update(isservice, b64)
{
    // This is run on the 'updated' agent. 
    
    var parm = b64 != null ? JSON.parse(Buffer.from(b64, 'base64').toString()) : null;
    var service = null;
    var serviceLocation = "";
    var px;

    console.setInfoLevel(1);
    console.info1('sys_update(' + isservice + ', ' + JSON.stringify(parm) + ')');
    if ((px = parm.getParameterIndex('fakeUpdate')) >= 0)
    {
        console.info1('Removing "fakeUpdate" parameter');
        parm.splice(px, 1);
    }

    if (isservice)
    {
        //
        // Service  Mode
        //

        // Check if we have sufficient permission
        if(!require('user-sessions').isRoot())
        {
            // We don't have enough permissions, so copying the binary will likely fail, and we can't start...
            // This is just to prevent looping, because agentcore.c should not call us in this scenario
            console.log('* insufficient permission to continue with update');
            process._exit();
            return;
        }
        var servicename = parm!=null?(parm.getParameter('meshServiceName', process.platform=='win32'?'Mesh Agent' : 'meshagent')):(process.platform == 'win32' ? 'Mesh Agent' : 'meshagent');
        try
        {
            service = require('service-manager').manager.getService(servicename)
            serviceLocation = service.appLocation();
            console.log(' Updating service: ' + servicename);
        }
        catch(f)
        {
            console.log(' * ' + servicename + ' SERVICE NOT FOUND *');
            process._exit();
        }
    }

    if (!global._interval)
    {
        global._interval = setInterval(sys_update, 60000, isservice, b64);
    }

    if (isservice === false)
    {
        //
        // Console Mode (LEGACY)
        //
        if (process.platform == 'win32')
        {
            serviceLocation = process.execPath.split('.update.exe').join('.exe');
        }
        else
        {
            serviceLocation = process.execPath.substring(0, process.execPath.length - 7);
        }

        if (serviceLocation != process.execPath)
        {
            try
            {
                require('fs').copyFileSync(process.execPath, serviceLocation);
            }
            catch (ce)
            {
                console.log('\nAn error occured while updating agent.');
                process.exit();
            }
        }

        // Copied agent binary... Need to start agent in console mode
        console.log('\nAgent update complete... Please re-start agent.');
        process.exit();
    }


    service.stop().finally(function ()
    {
        require('process-manager').enumerateProcesses().then(function (proc)
        {
            for (var p in proc)
            {
                if (proc[p].path == serviceLocation)
                {
                    process.kill(proc[p].pid);
                }
            }

            try
            {
                require('fs').copyFileSync(process.execPath, serviceLocation);
            }
            catch (ce)
            {
                console.log('Could not copy file.. Trying again in 60 seconds');
                service.close();
                return;
            }

            console.log('Agent update complete. Starting service...');
            service.start();
            process._exit();
        });
    });
}

function agent_updaterVersion(updatePath)
{
    if (updatePath == null) { updatePath = process.execPath; }
    var child = require('child_process').execFile(updatePath, [updatePath.split(process.platform == 'win32' ? '\\' : '/').pop(), '-updaterversion']);
    child.stdout.str = ''; child.stdout.on('data', function (c) { this.str += c.toString(); });
    child.waitExit();
    if(child.stdout.str.trim() == '')
    {
        return (0);
    }
    else
    {
        return (parseInt(child.stdout.str));
    }
}

function win_consoleUpdate()
{
    // This is run from the 'old' agent, to copy the 'updated' agent.
    var copy = [];
    copy.push("try { require('fs').copyFileSync(process.execPath, process.execPath.split('.update.exe').join('.exe')); }");
    copy.push("catch (x) { console.log('\\nError updating Mesh Agent.'); process.exit(); }");
    copy.push("if(require('child_process')._execve==null) { console.log('\\nMesh Agent was updated... Please re-run from the command line.'); process.exit(); }");
    copy.push("require('child_process')._execve(process.execPath.split('.update.exe').join('.exe'), [process.execPath.split('.update.exe').join('.exe'), 'run']);");
    var args = [];
    args.push(process.execPath.split('.exe').join('.update.exe'));
    args.push('-b64exec');
    args.push(Buffer.from(copy.join('\r\n')).toString('base64'));
    console.info1('_execve("' + process.execPath.split('.exe').join('.update.exe') + '", ' + JSON.stringify(args) + ');');
    require('child_process')._execve(process.execPath.split('.exe').join('.update.exe'), args);
}

module.exports.update = sys_update;
module.exports.updaterVersion = agent_updaterVersion;
if (process.platform == 'win32')
{
    module.exports.consoleUpdate = win_consoleUpdate;
}
