# Build your first Bicep template

> Source: Microsoft Learn module "Build your first Bicep template" (MicrosoftDocs/learn, CC BY 4.0). https://learn.microsoft.com/training/modules/build-first-bicep-file/

## Unit: Introduction

Bicep allows you to define your Azure resources in a simple templating language, then deploy those resources across multiple environments and applications. Bicep helps reduce manual deployment operations so you can scale your solutions more easily and with higher quality and consistency.

### Example scenario

Suppose you're responsible for deploying and configuring the Azure infrastructure at a toy company. Your company is launching a new toy. You've been asked to deploy a new marketing website in preparation for the launch. The marketing team has also told you that many new toys will be released this year, and it'll need a website deployed for each one. You know from past experience that you're not always given much time to get new websites up and running before a toy launches.

You'll host the website in Azure using Azure App Service. You'll incorporate a storage account for files, such as manuals and specifications, for the toy.

:::image type="content" source="../media/1-architecture-diagram.png" alt-text="Diagram that shows a resource group containing an App Service plan, an App Service app, and a storage account." border="false":::

You decide to build the resources using infrastructure as code (IaC) techniques so you can reuse the Bicep file for future product launches.

### What will we learn?

In this module, you'll create a reusable Bicep file to deploy a set of Azure resources for new product launches. You'll use many elements of the Bicep language, including:

- Resource definitions to deploy your Azure resources from your Bicep code.
- Parameters to make your Bicep file reusable.
- Variables and expressions to make it easier to write and deploy your Bicep file.
- Modules to help structure your Bicep file into multiple files.
- Outputs to send data from your Bicep file and modules back to whoever or whatever is deploying your infrastructure.

### What's the main goal?

By the end of this module, you'll be able to create Bicep files that define your Azure resources. You'll be able to use parameters, variables, and expressions to make your files reusable. You'll also be able to use modules and outputs to organize your files into separate files.

## Unit: What is Bicep

Bicep is a language for declaratively deploying Azure resources. Using Bicep, you can define how your Azure resources should be configured and deployed. You'll define your resources within a Bicep file, and submit the file to Azure Resource Manager. Resource Manager then takes responsibility for deploying each resource within the Bicep file on your behalf.

### How's Bicep related to ARM templates?

You might already be familiar with Azure Resource Manager templates (ARM templates), which are files that represent Azure resources. Until Bicep was available, ARM templates had to be written in a special JSON format. One common problem with JSON templates is that they're difficult to work with because they have a complex syntax. It can be hard to get started with writing ARM templates in JSON.

Bicep solves these problems by using a much simpler language designed specifically to help you deploy resources to Azure.

Behind the scenes, Resource Manager still operates based on the same JSON templates. When you submit a Bicep file to Resource Manager, the Bicep tooling converts your file to a JSON format in a process called _transpilation_. This process isn't something you typically have to think about, but you can view the JSON template file that's created from the Bicep file.

:::image type="content" source="../../includes/media/bicep-to-json.png" alt-text="Diagram that shows a Bicep file converted to a JSON template and deployed to Azure." border="false":::

### What do I need to install?

To get started with Bicep, you need to install some tooling. The easiest way is to install the latest version of the Azure CLI or Azure PowerShell. Both of these tools support Bicep files.

You also need a text editor to write your Bicep files. Visual Studio Code is a great text editor with an extension for writing Bicep files. These tools provide language support and resource autocompletion. They help you to create and validate Bicep files, and they tell you when your code doesn't follow recommended practices. You'll find installation links in the More info section of the Summary unit.

## Unit: Define resources in a Bicep template

Bicep files are the files you author that define the Azure resources to be deployed.

Your toy company needs you to create a reusable Bicep file for product launches. The file needs to deploy an Azure storage account and Azure App Service resources, which will be used for the marketing of each new product during its launch.

In this unit, you'll learn how to define a resource in a Bicep file, how resource names work, and how you can create resources that relate to each other.

> [!NOTE]
> The commands in this unit are shown to illustrate concepts. Don't run the commands yet. You'll practice what you learn here soon.

### Define a resource

The main thing you'll do with Bicep files is define your Azure resources. Here's an example of what a typical resource definition looks like in Bicep. This example creates a storage account named `toylaunchstorage`.

```bicep
resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'toylaunchstorage'
  location: 'westus3'
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
  }
}
```

Let's look closely at some key parts of this resource definition:

- The `resource` keyword at the start tells Bicep that you're about to define a resource.
- Next, you give the resource a _symbolic name_. In this example, that name is `storageAccount`. Use it in Bicep expressions to refer to the resource. It's distinct from the Azure resource name assigned through the `name` property.
- `Microsoft.Storage/storageAccounts@2023-05-01` specifies the _resource type_ and _API version_. `Microsoft.Storage/storageAccounts` declares an Azure storage account. `2023-05-01` selects the resource provider's management API version used for that resource deployment.

  > [!TIP]
  > The Bicep extension for Visual Studio Code helps you find the resource types and API versions for the resources you create. If you're familiar with ARM templates, note that the API version matches the version you'd use there too.

- You have to declare a _resource name_, which is the name the storage account will be assigned in Azure. You'll set a resource name using the `name` keyword.

  > [!IMPORTANT]
  > A symbolic name identifies a resource within the template. The resource's `name` property sets its Azure name. Changing only a symbolic name doesn't rename the deployed Azure resource.

- You'll then set other details of the resource, such as its location, SKU (pricing tier), and kind. There are also properties you can define that are different for each resource type. Different API versions might introduce different properties, too. In this example, we're setting the storage account's access tier to `Hot`.

> [!TIP]
> Resource names often have rules you must follow, like maximum lengths, allowed characters, and uniqueness across all of Azure. The requirements for resource names are different for each Azure resource type. Be sure to understand the naming restrictions and requirements before you add them to your Bicep file.

### What happens when resources depend on each other?

A Bicep file usually includes several resources. Often, you need a resource to depend on another resource. You might have to extract some information from one resource to be able to define another. If you're deploying a web application, you'll have to create the server infrastructure before you can add an application to it. These relationships are called _dependencies_.

You'll need to deploy an App Service app for the Bicep file that'll help launch the toy product, but to create an App Service app, you first need to create an App Service plan. The App Service plan represents the server-hosting resources, and it's declared like this example:

```bicep
resource appServicePlan 'Microsoft.Web/serverFarms@2023-12-01' = {
  name: 'toy-product-launch-plan'
  location: 'westus3'
  sku: {
    name: 'F1'
  }
}
```

This resource definition is telling Bicep you want to deploy an App Service plan that has the resource type `Microsoft.Web/serverFarms`. The plan resource is named `toy-product-launch-plan`, and it's deployed into the West US 3 region. It uses a pricing SKU of F1, which is App Service's free tier.

Now that you've declared the App Service plan, the next step is to declare the app:

```bicep
resource appServiceApp 'Microsoft.Web/sites@2023-12-01' = {
  name: 'toy-product-launch-1'
  location: 'westus3'
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
  }
}
```

This Bicep file instructs Azure to host the app on the plan you created. In the app's definition, `serverFarmId: appServicePlan.id` sets the app's `properties.serverFarmId` property to the resource ID of the App Service plan. The expression uses the plan's symbolic name, `appServicePlan`, to access its `id` property.

> [!TIP]
> An Azure resource ID identifies a resource and its scope. For the resource-group-scoped resources in this module, the ID includes the subscription ID, resource-group name, resource provider namespace, resource type, and resource name. Resources at other scopes use different ID formats. Reference a resource's `id` property, such as `appServicePlan.id`, rather than constructing its ID yourself. For more information, see Bicep resource-ID functions in the More info section of the Summary unit.

By declaring the app resource with a property that references the plan's symbolic name, Azure understands the _implicit dependency_ between the App Service app and the plan. When it deploys the resources, Azure ensures it fully deploys the plan before it starts to deploy the app.

## Unit: Exercise - Define resources in a Bicep file

> [!NOTE]
> This exercise is optional. If you want to complete it, you'll need an Azure subscription before you begin. If you don't have an Azure account or don't want to create one now, you can read through the instructions to understand the concepts.
>
> You'll also need a resource group. You can use an existing group or create one specifically for this exercise. A dedicated resource group makes cleanup easier. For instructions on creating a group with the Azure portal or Azure CLI, see the resource group management links in the More info section of the Summary unit.

For your toy-launch website, you decide to first create a proof of concept by creating a basic Bicep file. In this exercise, you'll create a storage account, Azure App Service plan, and app. Later, you'll modify the file to make it more reusable.

During the process, you'll:

> [!div class="checklist"]
>
> - Create a Bicep file that defines a single storage account resource that includes hard-coded values.
> - Provision your infrastructure and verify the result.
> - Add an App Service plan and app to the Bicep file.
> - Provision the infrastructure again to see the new resources.

This exercise uses the Bicep extension for Visual Studio Code. Be sure to install it before you begin. You'll find the extension link in the More info section of the Summary unit.

> [!IMPORTANT]
> These optional exercises create resources in your subscription and may incur charges. Prefer a new resource group dedicated to this module. The sample uses `eastus`; if you select another supported region before starting, use it for each resource as you add that resource in this exercise, and use it in the later `location` parameter defaults. If deployment is rejected because of subscription restrictions, policy, quota, or regional capacity, resolve the reported restriction before continuing. Don't switch to a paid App Service tier merely to bypass a deployment error without reviewing the cost.

### Create a Bicep file that contains a storage account

Start by defining a storage account in a new Bicep file:

1. Open Visual Studio Code.

1. Create a new Bicep file called _main.bicep_.

1. Save the empty file so that Visual Studio Code loads the Bicep tooling.

   You can either select **File** > **Save As** or select <kbd>Ctrl+S</kbd> in Windows (<kbd>⌘+S</kbd> on macOS). Be sure to remember where you've saved the file. For example, you might want to create a _files_ folder in which to save the file.

1. Add the following Bicep code into the Bicep file. You'll deploy the file soon. It's a good idea to type the code yourself instead of copying and pasting so you can see how the tooling helps you to write your Bicep files.

   :::code language="bicep" source="code/4-template.bicep" range="1-11":::

   > [!TIP]
   > Bicep is strict about where you put line breaks, so make sure you don't put line breaks in different places than listed here.

   Notice that Visual Studio Code automatically suggests property names as you type. The Bicep extension for Visual Studio Code understands the resources you're defining in your Bicep file, and it lists the available properties and values that you can use.

1. Update the name of the storage account from `toylaunchstorage` to something that's likely to be unique, because every storage account needs a globally unique name. Make sure the name is 3 to 24 characters and includes only lowercase letters and numbers.

   > [!IMPORTANT]
   > Don't skip this step. If you do, your Bicep file won't deploy successfully.

1. Save the changes to the file.

### Deploy the Bicep file to Azure

::: zone pivot="cli"

To deploy this template to Azure, you'll sign in to your Azure account from the Visual Studio Code terminal. Be sure you've installed the Azure CLI tools. Installation links are in the More info section of the Summary unit.

Open a Bash terminal for the Azure CLI commands:

1. On the **Terminal** menu, select **New Terminal**. The terminal window usually opens in the lower half of your screen.

1. If the terminal displays **bash** on the right side, the correct shell is already open. If you see a Bash shell icon on the right, you can select it to use that terminal.

   :::image type="content" source="../media/4-terminal-bash.png" alt-text="Screenshot of the Visual Studio Code terminal with the Bash shell label and icon highlighted.":::

   If another shell appears, select the shell dropdown arrow, then select **Git Bash** on Windows or **bash** on macOS or Linux.

   :::image type="content" source="../media/4-select-shell-bash.png" alt-text="Screenshot of the Visual Studio Code terminal shell menu with Git Bash selected.":::

1. In the terminal, go to the directory where you saved your template. For example, if you saved it in a _templates_ folder under the current directory, run:

   ```azurecli
   cd templates
   ```

#### Install Bicep

Run the following command to install or update the Azure CLI-managed Bicep CLI:

```azurecli
az bicep install && az bicep upgrade
```

#### Sign in to Azure by using Azure CLI

Sign in and select the subscription you'll use for this exercise:

1. In the Visual Studio Code terminal, run:

   ```azurecli
   az login
   ```

1. Complete the sign-in prompts in the browser or sign-in window that opens. If the terminal prompts you to choose a subscription, select the one you'll use for this exercise.

1. List the subscriptions associated with your account and find the name or ID of the subscription you want to use:

   ```azurecli
   az account list --output table
   ```

1. Select the subscription for the following Azure CLI commands. Replace `Your Subscription Name or ID` with the value from the previous step:

   ```azurecli
   az account set --subscription "Your Subscription Name or ID"
   ```

#### Select the resource group

Use the resource group you selected or created at the beginning of this exercise. Replace `YOUR_RESOURCE_GROUP_NAME` below with its actual name. Keep using this group in the remaining exercises. If you open a new terminal, sign in and select the intended subscription as needed, then set the variable again.

```azurecli
resourceGroupName='YOUR_RESOURCE_GROUP_NAME'
```

#### Deploy the Bicep file to Azure

Run the following command from the terminal in Visual Studio Code to deploy the Bicep file to Azure. The command can take a minute or two to complete.

A linter warning about a hard-coded location doesn't itself prevent deployment. In a later exercise, you'll make the location configurable. Deployment also depends on permissions, policy, quota, and resource availability in the selected region; inspect any deployment error before proceeding.

```azurecli
az deployment group create --resource-group "$resourceGroupName" --name main --template-file main.bicep
```

You'll see `Running...` in the terminal.

::: zone-end

::: zone pivot="powershell"

To deploy this template to Azure, you'll sign in to your Azure account from the Visual Studio Code terminal. Be sure you've installed Azure PowerShell. Installation links are in the More info section of the Summary unit.

Open a PowerShell terminal for the Azure PowerShell commands:

1. On the **Terminal** menu, select **New Terminal**. The terminal window usually opens in the lower half of your screen.

1. If the terminal displays **pwsh** or **powershell** on the right side, the correct shell is already open. If you see a PowerShell shell icon on the right, you can select it to use that terminal.

   :::image type="content" source="../media/4-terminal-powershell.png" alt-text="Screenshot of the Visual Studio Code terminal with the pwsh label and PowerShell icon highlighted.":::

   If another shell appears, select the shell dropdown arrow, then select **PowerShell**.

   :::image type="content" source="../media/4-select-shell-powershell.png" alt-text="Screenshot of the Visual Studio Code terminal shell menu with PowerShell selected.":::

1. In the terminal, go to the directory where you saved your template. For example, if you saved it in a _templates_ folder under the current directory, run:

   ```azurepowershell
   Set-Location -Path templates
   ```

#### Install the Bicep CLI

Azure PowerShell doesn't automatically install the Bicep CLI. Follow the Bicep installation for Azure PowerShell instructions in the More info section of the Summary unit. The standalone `bicep` executable must be available on your `PATH`; the Azure CLI-managed installation isn't added to `PATH`.

After installation, reopen your terminal if needed for the `PATH` change to take effect, then confirm that Bicep is available:

```azurepowershell
bicep --version
```

#### Sign in to Azure by using Azure PowerShell

Sign in and select the subscription you'll use for this exercise:

1. In the Visual Studio Code terminal, run:

   ```azurepowershell
   Connect-AzAccount
   ```

1. Complete the sign-in prompts in the browser or sign-in window that opens.

1. List your subscriptions and copy the ID of the subscription you want to use:

   ```azurepowershell
   Get-AzSubscription
   ```

   The ID looks something like `aaaa0a0a-bb1b-cc2c-dd3d-eeeeee4e4e4e`.

1. Select the subscription for the following Azure PowerShell commands. Replace `YOUR_SUBSCRIPTION_ID` with the ID from the previous step:

   ```azurepowershell
   Set-AzContext -SubscriptionId 'YOUR_SUBSCRIPTION_ID'
   ```

#### Select the resource group

Use the resource group you selected or created at the beginning of this exercise. Replace `YOUR_RESOURCE_GROUP_NAME` below with its actual name. Keep using this group in the remaining exercises. If you open a new terminal, sign in and select the intended subscription as needed, then set the variable again.

```azurepowershell
$resourceGroupName = 'YOUR_RESOURCE_GROUP_NAME'
```

#### Deploy the Bicep file to Azure

Deploy the Bicep file to Azure by using the following Azure PowerShell command in the terminal. The command can take a minute or two to complete.

A linter warning about a hard-coded location doesn't itself prevent deployment. In a later exercise, you'll make the location configurable. Deployment also depends on permissions, policy, quota, and resource availability in the selected region; inspect any deployment error before proceeding.

```azurepowershell
New-AzResourceGroupDeployment -ResourceGroupName $resourceGroupName -Name main -TemplateFile main.bicep
```

::: zone-end

### Verify the deployment

The first time you deploy a Bicep file, you might want to use the Azure portal to verify that the deployment has finished successfully and to inspect the results.

1. Go to the Azure portal and make sure you're in the correct subscription. The portal link is in the More info section of the Summary unit.

1. On the left-side panel, select **Resource groups**.

1. Select your resource group name.

1. In **Overview**, locate the **Deployments** information. You might need to expand **Essentials**. The displayed totals depend on the resource group's existing deployment history.

    :::image type="content" source="../media/4-deployment-succeeded.png" alt-text="Screenshot of the Azure portal resource group overview showing one successful deployment." border="true":::

1. Select the **Deployments** link to open the deployment history.

    :::image type="content" source="../media/4-deployment.png" alt-text="Screenshot of Azure portal deployment history showing one successful deployment." border="true":::

    > [!NOTE]
    > The screenshots show an example deployment history. Your totals can differ if the resource group already contains deployments or you repeat exercises. Identify the deployment by its name, latest operation time, and status instead of relying on a particular number of succeeded deployments.

1. Select the deployment called **main**. Confirm that its latest operation succeeded and corresponds to the command you just ran, then select **Deployment details** to expand it. In this case, there's one storage account with the name that you specified.

    :::image type="content" source="../media/4-deployment-details.png" alt-text="Screenshot of Azure portal deployment details listing a storage account." border="true":::

1. Leave the page open in your browser. You'll check on deployments again later.

::: zone pivot="cli"

You can also verify the deployment from the command line. To do so, run the following Azure CLI command:

```azurecli
az deployment group list --resource-group "$resourceGroupName" --output table
```

::: zone-end

::: zone pivot="powershell"

You can also verify the deployment from the command line. To do so, run the following Azure PowerShell command:

```azurepowershell
Get-AzResourceGroupDeployment -ResourceGroupName $resourceGroupName | Format-Table
```

::: zone-end

### Add an App Service plan and app to your Bicep file

In the previous task, you learned how to create a Bicep file that contains a single resource and deploy it. Now you're ready to deploy more resources, including a dependency. In this task, you'll add an App Service plan and app to the Bicep file.

1. In the _main.bicep_ file in Visual Studio Code, add the following code to the bottom of the file:

   :::code language="bicep" source="code/4-template.bicep" range="13-29":::

1. Update the name of the App Service app from `toy-product-launch-1` to something that's likely to be unique. Make sure the name is 2 to 60 characters with uppercase and lowercase letters, numbers, and hyphens, and doesn't start or end with a hyphen.

1. Save the changes to the file.

#### Deploy the updated Bicep file

::: zone pivot="cli"

Deploy the updated file using the same subscription, resource group, and resource location. A hard-coded-location linter warning isn't itself a deployment error.

```azurecli
az deployment group create --resource-group "$resourceGroupName" --name main --template-file main.bicep
```

::: zone-end

::: zone pivot="powershell"

Deploy the updated file using the same subscription, resource group, and resource location. A hard-coded-location linter warning isn't itself a deployment error.

```azurepowershell
New-AzResourceGroupDeployment -ResourceGroupName $resourceGroupName -Name main -TemplateFile main.bicep
```

::: zone-end

#### Check your deployment

Confirm that the updated deployment includes the App Service resources:

1. Return to the Azure portal and go to your resource group. Reusing the name `main` updates that deployment's history entry; other deployment entries can still be present.

1. Open the resource group's **Deployments** history.

1. Select the deployment called **main**. Confirm that its latest operation succeeded and corresponds to the command you just ran, then select **Deployment details** to expand the list of deployed resources.

    :::image type="content" source="../media/4-addapp-details.png" alt-text="Screenshot of Azure portal deployment details listing storage account and App Service resources." border="true":::

1. Notice that the App Service plan and app were deployed.

## Unit: Add flexibility by using parameters and variables

Bicep files are powerful because of their reusability. You can use Bicep to write files that deploy multiple environments or copies of your resources.

Your toy company launches new products regularly, and you need to use the Bicep files to create the Azure resources required for each product launch. You need to avoid using fixed resource names. Many types of Azure resources need unique names, so embedding names in your Bicep file means you can't reuse the file for multiple product launches. You also have to deploy the resources in different locations depending on where the toys will be launched, which means you can't embed the resource locations in your file either.

In this unit, you'll learn about _parameters_ and _variables_, which are two Bicep features that can make your Bicep files flexible and reusable. You'll also be introduced to _expressions_.

> [!NOTE]
> The commands in this unit are shown to illustrate concepts. Don't run the commands yet. You'll practice what you learn here soon.

### Parameters and variables

A _parameter_ lets you bring in values from outside the Bicep file. For example, if you're manually deploying the file by using the Azure CLI or Azure PowerShell, you'll be asked to provide values for each parameter. You can also create a _parameter file_, which lists all of the parameters and values you want to use for the deployment. If the Bicep file is deployed from an automated process like a deployment pipeline, the pipeline can provide the parameter values.

A _variable_ is defined and set within the Bicep file. Variables let you store important information in one place and refer to it throughout the file without having to copy and paste it.

It's usually a good idea to use parameters for things that'll change between each deployment, like:

- Resource names that need to be unique.
- Locations into which to deploy the resources.
- Settings that affect the pricing of resources, like their SKUs, pricing tiers, and instance counts.
- Credentials and information needed to access other systems that aren't defined in the Bicep file.

Variables are usually a good option when you'll use the same values for each deployment, but you want to make a value reusable within the file or when you want to use expressions to create a complex value. You can also use variables for resources that don't need unique names.

> [!TIP]
> It's important to use good naming for parameters and variables, so your Bicep files are easy to read and understand. Make sure you're using clear, descriptive, and consistent names.

### Add a parameter

In Bicep, you can define a parameter like this:

```bicep
param appServiceAppName string
```

Let's look at how each part of this definition works:

- `param` tells Bicep that you're defining a parameter.
- `appServiceAppName` is the name of the parameter. If you're deploying the Bicep file manually, you might be asked to enter a value, so it's important that the name is clear and understandable. The name is also how you refer to the parameter value within the file, just like with resource symbolic names.
- `string` is the type of the parameter. You can specify several different types for Bicep parameters, including `string` for text, `int` for numbers, and `bool` for Boolean true or false values. You can also pass in more complex parameters by using the `array` and `object` types.

> [!TIP]
> Try not to overgeneralize Bicep files by using too many parameters. You should use the minimum number of parameters you need for your business scenario. Remember, you can always change Bicep files in the future if your requirements change.

#### Provide default values

You can optionally provide a _default value_ for a parameter. When you specify a default value, the parameter becomes optional. The person who's deploying the Bicep file can specify a value if they want, but if they don't, Bicep uses the default value.

Here's how you can add a default value:

```bicep
param appServiceAppName string = 'toy-product-launch-1'
```

> [!NOTE]
> In this example, the Azure App Service app name has a hard-coded default value. This isn't a good idea because App Service apps need unique names. You'll fix this shortly.

#### Use parameter values in the Bicep file

After you've declared a parameter, you can refer to it throughout the rest of the Bicep file. Let's see how you can use your new parameter within the resource definition:

:::code language="bicep" source="code/5-parameter-value.bicep" highlight="2":::

Notice that the Bicep file now uses the parameter value to set the resource name for the app resource, instead of a hard-coded value.

> [!TIP]
> The Bicep extension for Visual Studio Code shows you visual indicators to let you know when you're not following recommended practices. For example, it warns you if you define a parameter that you don't use. The _Bicep linter_ continuously runs these checks while you work.

### Add a variable

You can define a variable like this:

```bicep
var appServicePlanName = 'toy-product-launch-plan'
```

Variables are defined in a similar way to parameters, but there are a few differences:

- Use the `var` keyword to tell Bicep you're declaring a variable.
- You must provide a value for a variable.
- Variables don't need types. Bicep can determine the type based on the value that you set.

### Expressions

When you're writing Bicep files, you often don't want to hard-code values or ask for them to be specified in a parameter. Instead, you want to discover values when the file runs. For example, you probably want to deploy all of the resources in a Bicep file into a single Azure region: the region where you've created the resource group. Or, you might want to automatically create a unique name for a resource based on a particular naming strategy your company uses.

_Expressions_ in Bicep are a powerful feature that helps you handle all sorts of interesting scenarios. Let's take a look at a few places where you can use expressions in a Bicep file.

#### Resource locations

When you're writing and deploying a template, you often don't want to have to specify the location of every resource individually. Instead, you might have a simple business rule that says, _by default, deploy all resources into the same location in which the resource group was created_.

In Bicep, you can create a parameter called `location`, then use an expression to set its value:

```bicep
param location string = resourceGroup().location
```

Look at the default value of that parameter. It uses a _function_ called `resourceGroup()` that gives you access to information about the resource group into which the Bicep file is being deployed. In this example, the file uses the `location` property. It's common to use this approach to deploy your resources into the same Azure region as the resource group.

If someone is deploying this Bicep file, they might choose to override the default value here and use a different location.

> [!NOTE]
> Some resources in Azure can be deployed only into certain locations. You might need separate parameters to set the locations of these resources.

You can now use the resource location parameter inside the Bicep file, like this:

:::code language="bicep" source="code/5-variable-value.bicep" highlight="3":::

#### Resource names

Many Azure resources need unique names. In your scenario, you have two resources that need unique names: the storage account and the App Service app. Asking for these values to be set as parameters can make it difficult for whoever uses the Bicep file because they need to find a name that nobody else has used.

Bicep has another function called `uniqueString()` that comes in handy when you're creating resource names. When you use this function, you need to provide a _seed value_, which should be different across different deployments, but consistent across all deployments for the same resources.

If you choose a good seed value, you can get the same name every time you deploy the same set of resources, but you'll get a different name whenever you deploy a different set of resources by using the same Bicep file. Let's look at how you might use the `uniqueString()` function:

```bicep
param storageAccountName string = uniqueString(resourceGroup().id)
```

This parameter's default value uses the `resourceGroup()` function again, like you did when you set the resource location. This time, though, you're getting the ID for a resource group. Here's what a resource group ID looks like:

```Output
/subscriptions/aaaa0a0a-bb1b-cc2c-dd3d-eeeeee4e4e4e/resourceGroups/MyResourceGroup
```

The resource group ID includes the Azure subscription ID (`aaaa0a0a-bb1b-cc2c-dd3d-eeeeee4e4e4e`) and the resource group name (`MyResourceGroup`). The resource group ID is often a good candidate for a seed value for resource names because:

- Every time you deploy the same resources, they'll go into the same resource group. The `uniqueString()` function will return the same value every time.
- If you deploy into two different resource groups in the Azure subscription, the `resourceGroup().id` value will be different because the resource group names will be different. The `uniqueString()` function will give different values for each set of resources.
- If you deploy into two different Azure subscriptions, _even if you use the same resource group name_, the `resourceGroup().id` value will be different because the Azure subscription ID will be different. The `uniqueString()` function will again give different values for each set of resources.

> [!TIP]
> It's often a good idea to use Bicep file expressions to create resource names. Many Azure resource types have rules about the allowed characters and length of their names. Embedding the creation of resource names in the Bicep file means that anyone who uses the file doesn't have to remember to follow these rules themselves.

#### Combined strings

If you just use the `uniqueString()` function to set resource names, you'll probably get unique names, but they won't be meaningful. A good resource name should also be descriptive, so that it's clear what the resource is for. You'll often want to create a name by combining a meaningful word or string with a unique value. This way, you'll have resources that have both meaningful _and_ unique names.

Bicep has a feature called _string interpolation_ that lets you combine strings. Let's see how it works:

```bicep
param storageAccountName string = 'toylaunch${uniqueString(resourceGroup().id)}'
```

The default value for the `storageAccountName` parameter now has two parts to it:

- `toylaunch` is a hard-coded string that helps anyone who looks at the deployed resource in Azure to understand the storage account's purpose.
- `${uniqueString(resourceGroup().id)}` is a way of telling Bicep to evaluate the output of the `uniqueString(resourceGroup().id)` function, then concatenate it into the string.

> [!TIP]
> Storage account names must be globally unique, contain 3 to 24 characters, and use only lowercase letters and numbers. They can start with a number. A descriptive prefix makes a generated name easier to recognize; it isn't required to prevent a leading digit. For example, `toylaunch` plus the 13-character result of `uniqueString()` produces a 22-character name. The function reduces the likelihood of a collision but doesn't guarantee global uniqueness.

#### Selecting SKUs for resources

The other members of your team are impressed with the Bicep code you've built so far. You've decided together that you'll use your Bicep file to deploy the resources to support all your new toy launches.

One of your colleagues has suggested that you create non-production environments for each product launch to help the marketing team test the sites before they're available to customers. However, you want to make sure you don't spend too much money on your non-production environments, so you decide on some policies together:

- In production environments, storage accounts will be deployed at the `Standard_GRS` (geo-redundant storage) SKU for high resiliency. App Service plans will be deployed at the `P2v3` SKU for high performance.
- In non-production environments, storage accounts will be deployed at the `Standard_LRS` (locally redundant storage) SKU. App Service plans will be deployed at the free `F1` SKU.

One way to implement these business requirements is to use parameters to specify each SKU. However, specifying every SKU as a parameter can become difficult to manage, especially when you have larger Bicep files. Another option is to embed the business rules into the file by using a combination of parameters, variables, and expressions.

First, you can specify a parameter that indicates whether the deployment is for a production or non-production environment:

```bicep
@allowed([
  'nonprod'
  'prod'
])
param environmentType string
```

Notice that this code uses some new syntax to specify a list of _allowed values_ for the `environmentType` parameter. Bicep won't let anyone deploy the Bicep file unless they provide one of these values.

Next, you can create variables that determine the SKUs to use for the storage account and App Service plan based on the environment:

```bicep
var storageAccountSkuName = (environmentType == 'prod') ? 'Standard_GRS' : 'Standard_LRS'
var appServicePlanSkuName = (environmentType == 'prod') ? 'P2V3' : 'F1'
```

Notice some new syntax here, too. Let's break it down:

- `(environmentType == 'prod')` evaluates to a Boolean (true or false) value, depending on which allowed value is used for the `environmentType` parameter.
- `?` is called a _ternary operator_, and it evaluates an `if/then` statement. The value after the `?` operator is used if the expression is true. If the expression evaluates to false, the value after the colon (`:`) is used.

We can translate these rules to:

- For the `storageAccountSkuName` variable, if the `environmentType` parameter is set to `prod`, then use the `Standard_GRS` SKU. Otherwise, use the `Standard_LRS` SKU.
- For the `appServicePlanSkuName` variable, if the `environmentType` parameter is set to `prod`, then use the `P2V3` SKU and the `PremiumV3` tier. Otherwise, use the `F1` SKU.

> [!NOTE]
> These expressions select the resource SKUs; they don't create a separate environment by themselves. In this example, changing only `environmentType` doesn't change resource names. With the same resource group and resource names, a deployment updates the existing resources. To keep production and non-production environments separate, use a dedicated resource group for each environment and available resource names. Continue using the same group for successive deployments of that environment.
>
> Before deploying `prod`, confirm that the chosen region and subscription support the required SKUs and review their costs. Upgrading an existing App Service plan to `P2v3` also requires its underlying App Service deployment unit to support PremiumV3 and that specific SKU. If the deployment unit doesn't support it, follow the PremiumV3 redeployment guidance in the More info section of the Summary unit: create a new resource group and a new plan initially using the desired PremiumV3 SKU, then redeploy the app. Changing only the plan name in the same resource-group, region, and operating-system combination might not resolve this restriction.

<!-- -->

> [!TIP]
> When you create multipart expressions like this, it's best to use variables rather than embedding the expressions directly into the resource properties. This makes your Bicep files easier to read and understand because it avoids cluttering your resource definitions with logic.

When you use parameters, variables, and expressions in your Bicep file, you can reuse your file and quickly deploy a new set of resources. For example, each time your marketing department asks you to deploy a new website for the next toy launch, you supply new parameter values for each environment that you deploy, and you'll be set!

## Unit: Exercise - Add parameters and variables to your Bicep file

> [!NOTE]
> This exercise is optional. If you want to complete it, you'll need an Azure subscription before you begin. If you don't have an Azure account or don't want to create one now, you can read through the instructions to understand the concepts.

In this exercise, you'll update the Bicep file you previously created so it:

- Accepts parameters for the resource locations and names.
- Uses your business rules to select the right SKUs for the resources being deployed.

During the process, you'll:

> [!div class="checklist"]
>
> - Update the Bicep file to include a `location` parameter.
> - Update the Bicep file to include parameters and variables for the resource names.
> - Use expressions to set default values for the parameters.
> - Update the Bicep file to include variables for the SKU of each resource.
> - Test the deployment to ensure that the Bicep file is valid.

### Add the location and resource name parameters

Make resource locations and names configurable by adding parameters to your file:

1. In the _main.bicep_ file in Visual Studio Code, add the following code to the top of the Bicep file:

   :::code language="bicep" source="code/6-template-1.bicep" range="1-5":::

   The Bicep linter adds yellow squiggly lines underneath each parameter and variable name to indicate they're not used in the Bicep file. You'll fix this issue soon.

   Notice that you're using expressions that include string interpolation and the `uniqueString()` function to define default parameter values. Someone deploying this Bicep file can override the default parameter values by specifying the values at deployment time, but they can't override the variable values.

   Also notice that you're using a variable for the Azure App Service plan name, but you're using parameters for the other names. Storage accounts and App Service apps need globally unique names, but App Service plan names need to be unique only within their resource group. This difference means it's not a concern to use the same App Service plan name across different deployments, as long as the deployments are all going into different resource groups.

   > [!NOTE]
   > Complete this exercise in your own Azure subscription. These examples use `eastus` as the default resource location. Your resource group's location stores its metadata; it doesn't require every resource in the group to use that region. Choose a region where your subscription can create the required storage account and Windows App Service Free (F1) plan. If you need another region, use it consistently for the app, its plan, and the storage account, and keep that choice in subsequent deployments. A reusable template can instead default to `resourceGroup().location` when that region is appropriate for all of its resources.
   >
   > Changing a resource's `location` property doesn't move an existing resource. If you restart these exercises in another region, use a new dedicated resource group and available resource names.

1. Find the places within the resource definitions where the `location` and `name` properties are set, and update them to use the parameter values. After you're finished, the resource definitions within your Bicep file should look like this:

   :::code language="bicep" source="code/6-template-1.bicep" range="7-34" highlight="2-3, 14-15, 22-23":::

1. Save the changes to the file.

### Automatically set the SKUs for each environment type

Use an environment parameter and variables to select the appropriate resource SKUs:

1. In the _main.bicep_ file in Visual Studio Code, add the following Bicep parameter below the parameters that you created in the previous task:

   :::code language="bicep" source="code/6-template-2.bicep" range="5-9":::

   Notice that you're defining a parameter with a set of allowed values, but you're not specifying a default value for this parameter.

1. Below the line that declares the `appServicePlanName` variable, add the following variable definitions:

   :::code language="bicep" source="code/6-template-2.bicep" range="12-13" :::

   Notice that you're setting these variables' values by using the ternary operator to express some `if/then/else` logic.

1. Find the storage account and App Service plan `sku.name` properties. Set them to the `storageAccountSkuName` and `appServicePlanSkuName` variables, respectively. These variables compute their values from the `environmentType` parameter. After you finish, the resource definitions should look like the following example.

   :::code language="bicep" source="code/6-template-2.bicep" range="15-42" highlight="5, 17":::

   Notice that you haven't parameterized everything. You've set some properties right in the resource definitions, where you know these values aren't going to change between deployments.

   > [!NOTE]
   > Continue setting `environmentType` to `nonprod` and using the same exercise resource group for this walkthrough. The `prod` value illustrates a paid production configuration, not a step to run in these exercises. Before using it for a separate environment, review the production deployment prerequisites in Selecting SKUs for resources in the Add flexibility by using parameters and variables unit.

1. Save the changes to the file.

### Verify your Bicep file

After you've completed all of the preceding changes, your _main.bicep_ file should look like this example:

:::code language="bicep" source="code/6-template-2.bicep" :::

If your file doesn't match, copy the example or adjust your file to match the example.

#### Deploy the updated Bicep file

> [!NOTE]
> Use the same subscription and resource group throughout these exercises. Reapply any resource-name or location parameter overrides from the preceding deployment; otherwise, the defaults in the template are used again.

::: zone pivot="cli"

Run the following Azure CLI command in the terminal.

```azurecli
az deployment group create \
  --resource-group "$resourceGroupName" \
  --name main \
  --template-file main.bicep \
  --parameters environmentType=nonprod
```

::: zone-end

::: zone pivot="powershell"

Run the following Azure PowerShell command in the terminal.

```azurepowershell
New-AzResourceGroupDeployment `
  -ResourceGroupName $resourceGroupName `
  -Name main `
  -TemplateFile main.bicep `
  -environmentType nonprod
```

::: zone-end

Notice that you're explicitly specifying the value for the `environmentType` parameter when you execute the deployment. You don't need to specify the other parameter values, because they have valid default values.

#### Check your deployment

Confirm that your deployment uses the expected resource names:

1. In your browser, return to the Azure portal and go to your resource group. Reusing the name `main` updates that deployment's history entry rather than adding a separately named deployment.

1. Open the resource group's **Deployments** history.

1. Select the deployment called **main**. Confirm that its latest operation succeeded and corresponds to the command you just ran, then select **Deployment details** to expand the list of deployed resources.

    :::image type="content" source="../media/6-addparams-details.png" alt-text="Screenshot of Azure portal deployment details showing generated names for storage account and App Service resources." border="true":::

1. Notice that the app and storage account names are generated deterministically from the resource group ID. With the same inputs, `uniqueString()` returns the same value on each deployment. If you supplied explicit resource-name parameter values, those values are used instead of the generated defaults.

   > [!NOTE]
   > The sample now also uses the App Service plan name `toy-product-launch-plan`, rather than `toy-product-launch-plan-starter`. When the new names differ from the earlier exercise's names, this deployment creates a new app, storage account, and plan. The default incremental deployment mode leaves the earlier resources in the resource group; it doesn't rename or delete them. Reusing the deployment name `main` replaces that deployment's history entry, not the earlier resources.

## Unit: Group related resources by using modules

You've started to use Bicep files for some recent product launches, and they've been successful. Because you've declared your resources in a file, you can quickly deploy the resources for new toy launches without needing to manually configure resources in the Azure portal.

The IT manager can see your Bicep code is becoming more complex and has an increasing number of resources defined, so they've asked if you can make the code more _modularized_. You can create individual Bicep files, called modules, for different parts of your deployment. The main Bicep file can reference these modules. Behind the scenes, modules are transpiled into a single JSON template for deployment.

Modules are also a way to make Bicep code even more reusable. You can have a single Bicep module that many other Bicep files use.

You'll also often need to emit _outputs_ from the Bicep modules and files. Outputs are a way for your Bicep code to send data back to whoever or whatever started the deployment. Let's look at outputs first.

> [!NOTE]
> The commands in this unit are shown to illustrate concepts. Don't run the commands yet. You'll practice what you learn here soon.

### Outputs

A human can manually deploy Bicep files, or some sort of automated release process can deploy them. Either way, it's common to have some data from the file you need to send back to whoever or whatever is executing the file deployment.

Here are some example scenarios where you might need to get information from the Bicep file deployment:

- You create a Bicep file that deploys a virtual machine, and you need to get the public IP address so you can SSH into the machine.
- You create a Bicep file that accepts a set of parameters, like an environment name and an application name. The file uses an expression to name an Azure App Service app that it deploys. You need to output the app's name that the file has deployed so you can use it within a deployment pipeline to publish the application binaries.

You can use outputs for these scenarios. To define an output in a Bicep file, use the `output` keyword like this:

```bicep
output appServiceAppName string = appServiceAppName
```

The output definition includes a few key parts:

- The `output` keyword tells Bicep you're defining an output.
- `appServiceAppName` is the output's name. When someone deploys the Bicep file successfully, the output values include the name you specified so they can access the values they're expecting.
- `string` is the output type. Bicep outputs support the same types as parameters.
- A value must be specified for each output. Unlike parameters, outputs always need to have values. Output values can be expressions, references to parameters or variables, or properties of resources that are deployed within the file.

> [!TIP]
> Outputs can use the same names as variables and parameters. This convention can be helpful if you construct a complex expression within a variable to use within your Bicep file's resources, and you also need to expose the variable's value as an output.

Here's another example of an output. It'll have its value set to the fully qualified domain name (FQDN) of a public IP address resource.

```bicep
output ipFqdn string = publicIPAddress.properties.dnsSettings.fqdn
```

> [!TIP]
> Try to use resource properties as outputs rather than making assumptions about how resources will behave. For example, if you need to have an output for an App Service app's URL, use the app's `defaultHostName` property instead of creating a string for the URL yourself. Sometimes these assumptions aren't valid in different environments, or the way the resource works changes, so it's safer to have the resource tell you its own properties.

> [!CAUTION]
> Don't put secrets, such as keys or connection strings, in ordinary outputs. Ordinary output values are stored in deployment history and can be read by users with the required deployment read permissions. Bicep 0.35.1 and later supports `@secure()` on string and object outputs to prevent those values from appearing in deployment history, the Azure portal, or command-line output. This module outputs only a non-secret host name.

### Define a module

Bicep modules allow you to organize and reuse your Bicep code by creating smaller units that can be composed into a Bicep file. Any Bicep file can be used as a module by another template. Throughout this learning module, you've created Bicep files. That means you've already created files that can be used as Bicep modules!

Imagine you have a Bicep file that deploys application, database, and networking resources for _solution A_. You might split this Bicep file into three modules, each of which is focused on its own set of resources. As a bonus, you can now reuse the modules in other templates for other solutions too; so when you develop a file for _solution B_, which has similar networking requirements to _solution A_, you can reuse the network module.

:::image type="content" source="../../includes/media/bicep-files-modules.png" alt-text="Diagram that shows solution A using application, database, and networking modules, with solution B reusing the networking module." border="false":::

When you want the Bicep file to include a reference to a module file, use the `module` keyword. A module definition looks similar to a resource declaration, but instead of including a resource type and API version, you'll use the module's file name:

```bicep
module myModule 'modules/mymodule.bicep' = {
  name: 'MyModule'
  params: {
    location: location
  }
}
```

Let's look closely at some key parts of this module definition:

- The `module` keyword tells Bicep you're about to use another Bicep file as a module.
- Just like resources, modules need a _symbolic name_ like `myModule`. You'll use the symbolic name when you refer to the module's outputs in other parts of the Bicep file.
- `modules/mymodule.bicep` is the path to the module Bicep file, relative to the file. Remember, a module file is just a regular Bicep file.
- The `name` property sets the name of the nested deployment that Azure creates for the module. It's optional in Bicep 0.34.1 and later; Bicep generates a name when it's omitted. This example specifies a name so that you can easily identify the deployment in Azure. For more information, see Bicep modules in the More info section of the Summary unit.
- You can specify any _parameters_ of the module by using the `params` keyword. When you set the values of each parameter within the Bicep file, you can use expressions, file parameters, variables, properties of resources deployed within the file and outputs from other modules. Bicep will automatically understand the dependencies between the resources.

### Modules and outputs

Just like templates, Bicep modules can define outputs. It's common to chain modules together within a template. In that case, the output from one module can be a parameter for another module. By using modules and outputs together, you can create powerful and reusable Bicep files.

### Design your modules

A good Bicep module follows some key principles:

> [!div class="checklist"]
>
> - **A module should have a clear purpose.** You can use modules to define all of the resources related to a specific part of your solution. For example, you might create a module that contains all of the resources used to monitor your application. You might also use a module to define a set of resources that belong together, like all of your database servers and databases.
>
> - **Don't put every resource into its own module.** You shouldn't create a separate module for every resource you deploy. If you have a resource that has many complex properties, it might make sense to put that resource into its own module, but in general, it's better for modules to combine multiple resources.
>
> - **A module should have clear parameters and outputs that make sense.** Consider the purpose of the module. Think about whether the module should manipulate parameter values, or whether the parent Bicep file should handle that, and then pass a single value through to the module. Similarly, think about the outputs a module should return, and make sure they're useful to the Bicep files that'll use the module.
>
> - **A module should be as self-contained as possible.** If a module needs to use a variable to define a part of a module, the variable should generally be included in the module Bicep file rather than in the parent Bicep file.
>
> - **A module shouldn't expose secrets through ordinary outputs.** Prefer retrieving secret resource properties where they're needed. If a design requires a secure module output, use the supported secure-output feature and preserve its protection at every subsequent boundary.

## Unit: Exercise - Refactor your Bicep file to use modules

> [!NOTE]
> This exercise is optional. If you want to complete it, you'll need an Azure subscription before you begin. If you don't have an Azure account or don't want to create one now, you can read through the instructions to understand the concepts.

In this exercise, you'll update the Bicep file you previously created so it uses a module for the Azure App Service resources. Modules help to keep the intention of the main file clearer. You can reuse the App Service module in other Bicep files if you choose to.

During the process, you'll:

> [!div class="checklist"]
>
> - Add a new module and move the App Service resources into it.
> - Reference the module from the main Bicep file.
> - Add an output for the App Service app's host name, and emit it from the module and Bicep file deployments.
> - Test the deployment to ensure that the Bicep file is valid.

### Add a new module file

Create a self-contained module for your App Service resources:

1. In Visual Studio Code, create a new folder called _modules_ in the same folder where you created your _main.bicep_ file. In the _modules_ folder, create a file called _appService.bicep_. Save the file.

1. Add the following content into the _appService.bicep_ file:

   :::code language="bicep" source="code/8-app-service.bicep" range="1-28" :::

   Notice that you've copied the parameters and variables from your _main.bicep_ Bicep file since the _appService.bicep_ Bicep file needs to be self-contained.

1. Save the changes to the file. Notice that Visual Studio Code doesn't show you any red squiggles to indicate warnings about missing variables, missing parameters, or invalid resources.

#### Add a reference to the module from the parent Bicep file

Now that you've created a complete module to deploy the App Service resources, you can refer to the module within the parent Bicep file. Because the module deploys the App Service resources, you can delete the associated resources and variables from the parent file.

1. In the _main.bicep_ file, delete the App Service resources and the `appServicePlanName` and `appServicePlanSkuName` variable definitions. Don't delete the App Service parameters, because you still need them. Also, don't delete the storage account parameters, variable, or resources.

1. At the bottom of the _main.bicep_ file, add the following Bicep code:

   :::code language="bicep" source="code/8-template.bicep" range="25-32" :::

   Notice that you're specifying the parameters for your module by referencing the parameters in the parent Bicep file.

1. Save the changes to the file.

### Add the host name as an output

Expose the app's host name from both the module and its parent file:

1. Add the following Bicep code at the bottom of the _appService.bicep_ file:

   :::code language="bicep" source="code/8-app-service.bicep" range="30" :::

   This code declares that an output for this module, which will be named `appServiceAppHostName`, will be of type `string`. The output will take its value from the `defaultHostName` property of the App Service app.

1. Save the changes to the file.

   The output is declared in the App Service module. The parent file can read it through `appService.outputs.appServiceAppHostName`, but it isn't automatically included in the parent deployment's outputs. Add a matching output to the parent file so that someone inspecting the `main` deployment can retrieve it there. This ordinary, non-secret output can also be read from the module's nested deployment record by a user with the required deployment read permissions.

1. Open the _main.bicep_ file and add the following code at the bottom of the file:

   :::code language="bicep" source="code/8-template.bicep" range="34" :::

   Notice that this output is declared in a similar way to the output in the module. But this time, you're referencing the module's output instead of a resource property.

1. Save the changes to the file.

### Verify your Bicep files

After you've completed all of the preceding changes, your _main.bicep_ file should look like this example:

:::code language="bicep" source="code/8-template.bicep" :::

Your _appService.bicep_ file should look like this example:

:::code language="bicep" source="code/8-app-service.bicep" :::

If either Bicep file doesn't match, copy the example or adjust your file to match the example.

#### Deploy the updated Bicep file

> [!NOTE]
> Use the same subscription and resource group throughout these exercises. Reapply any resource-name or location parameter overrides from the preceding deployment; otherwise, the defaults in the template are used again.
>
> Continue setting `environmentType` to `nonprod` and using the same exercise resource group for this walkthrough. The `prod` value illustrates a paid production configuration, not a step to run in these exercises. Before using it for a separate environment, review the production deployment prerequisites in Selecting SKUs for resources in the Add flexibility by using parameters and variables unit.

::: zone pivot="cli"

Run the following Azure CLI command in the terminal.

```azurecli
az deployment group create \
  --resource-group "$resourceGroupName" \
  --name main \
  --template-file main.bicep \
  --parameters environmentType=nonprod
```

::: zone-end

::: zone pivot="powershell"

Run the following Azure PowerShell command in the terminal.

```azurepowershell
New-AzResourceGroupDeployment `
  -ResourceGroupName $resourceGroupName `
  -Name main `
  -TemplateFile main.bicep `
  -environmentType nonprod
```

::: zone-end

#### Check your deployment

Confirm that the module deployed and returned the app's host name:

1. In your browser, return to the Azure portal. Go to your resource group and open **Deployments**.

1. Locate the `main` deployment and the nested `appService` deployment. A successful run creates or updates these named entries. Other deployments might also be listed.

    :::image type="content" source="../media/8-addmodule-deployment.png" alt-text="Screenshot of Azure portal deployment history showing successful main and appService deployments." border="true":::

1. Select the deployment called **main**. Confirm that its latest operation succeeded and corresponds to the command you just ran, then select **Deployment details** to expand the list of deployed resources.

    Notice that our module deployment appears in the list.

    :::image type="content" source="../media/8-addmodule-details.png" alt-text="Screenshot of Azure portal deployment details listing the App Service module." border="true":::

1. Select the **Outputs** tab. Notice that there's an output called **appServiceAppHostName** with the host name of your App Service app. Copy the host name to your clipboard.

    :::image type="content" source="../media/8-addmodule-outputs.png" alt-text="Screenshot of Azure portal deployment outputs showing the App Service app's host name." border="true":::

1. Open a new browser tab and paste the host name that you copied. You should see the default App Service welcome page.

     :::image type="content" source="../media/8-addmodule-appservice.png" alt-text="Screenshot of the default welcome page for an Azure App Service app." border="true":::

Congratulations! You've successfully deployed the foundations for a great app.

## Unit: Summary

Your company needs to launch new toys regularly to stay competitive. The shorter the time to market, the better.

You've created a file that deploys a website and storage resources. This file is reusable for future product launches, which means you've significantly cut the time it takes to launch a new product.

You created a Bicep file to deploy a basic storage account, an Azure App Service plan, and an application. You parameterized the file to make it useful for future products. You then refactored it into modules to make the file more reusable and easier to understand and work with. Finally, you added an output to send information from a file deployment back to the person or tool executing the deployment.

Imagine how much work it would be to deploy these resources for each new product launch. You'd have to manually provision the resources and remember to configure them correctly each time.

Bicep makes it easy to describe your Azure resources and create reusable files. You can parameterize the files and use modules to separate your files into different components that you can reuse and work on individually.

Now, when you want to prepare your resources for the next product launch, you can use the Bicep file you created with parameter values unique to the product launch. Your company can quickly and easily provision its Azure resources.

> [!TIP]
> In this module, you've only scratched the surface of Bicep's capabilities. Keep following the Fundamentals of Bicep learning path and our other Bicep learning paths to progress your understanding. You'll find the link in More info.

<!-- -->

> [!IMPORTANT]
> If you completed the optional exercises, you created resources by using your own Azure subscription. Clean up these resources so that you won't continue to be charged for them.
>
> Clean up resources from both the initial and parameterized exercises. If you created a resource group exclusively for this module and no longer need anything in it, delete that group. If you used an existing group, delete only the resources created for this exercise after checking their dependencies; don't delete unrelated resources.

### More info

Use these resources to review the module's concepts and explore the sources cited in the technical review.

#### Tools and setup

Set up your subscription and tools, then access your Azure resources:

- [Azure trial subscription](https://azure.microsoft.com/pricing/purchase-options/azure-account?cid=msft_learn)
- [Visual Studio Code](https://code.visualstudio.com/)
- [Bicep extension for Visual Studio Code](https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-bicep)
- [Install Azure CLI](/cli/azure/install-azure-cli)
- [Install Azure PowerShell](/powershell/azure/install-az-ps)
- [Install Bicep tools](/azure/azure-resource-manager/bicep/install), including [Bicep installation for Azure PowerShell](/azure/azure-resource-manager/bicep/install#azure-powershell)
- [Azure portal](https://portal.azure.com?azure-portal=true)

#### Bicep language

Learn more about the language features used in this module:

- [Bicep documentation](/azure/azure-resource-manager/bicep)
- [Resource declarations](/azure/azure-resource-manager/bicep/resource-declaration) and [implicit resource dependencies](/azure/azure-resource-manager/bicep/resource-dependencies#implicit-dependency)
- [Parameter defaults and allowed values](/azure/azure-resource-manager/bicep/parameters) and [variables](/azure/azure-resource-manager/bicep/variables)
- [Bicep functions](/azure/azure-resource-manager/bicep/bicep-functions), [resource-ID functions](/azure/azure-resource-manager/bicep/bicep-functions-resource), and [`uniqueString()`](/azure/azure-resource-manager/bicep/bicep-functions-string#uniquestring)
- [Bicep modules](/azure/azure-resource-manager/bicep/modules#define-modules) and [local module paths](/azure/azure-resource-manager/bicep/modules#local-file)
- [Bicep outputs](/azure/azure-resource-manager/bicep/outputs), [defining outputs](/azure/azure-resource-manager/bicep/outputs#define-outputs), and [secure outputs](/azure/azure-resource-manager/bicep/outputs#secure-outputs)
- [Bicep 0.34.1 release notes](https://github.com/Azure/bicep/releases/tag/v0.34.1)

#### Deployment and resource management

Review deployment behavior, resource naming, and configuration:

- [Azure CLI deployment guidance](/azure/azure-resource-manager/bicep/deploy-cli), [deploying a local Bicep file](/azure/azure-resource-manager/bicep/deploy-cli#deploy-local-bicep-file), and [deployment-name behavior](/azure/azure-resource-manager/bicep/deploy-cli#deployment-name)
- [Azure PowerShell deployment guidance](/azure/azure-resource-manager/bicep/deploy-powershell) and [inline parameters](/azure/azure-resource-manager/bicep/deploy-powershell#inline-parameters)
- [Deployment modes](/azure/azure-resource-manager/templates/deployment-modes) and [incremental deployment behavior](/azure/azure-resource-manager/templates/deployment-modes#incremental-mode)
- [Resource groups and their locations](/azure/azure-resource-manager/management/manage-resource-groups-portal#what-is-a-resource-group)
- [Manage resource groups with the Azure portal](/azure/azure-resource-manager/management/manage-resource-groups-portal) and [manage resource groups with Azure CLI](/azure/azure-resource-manager/management/manage-resource-groups-cli)
- [Resource naming rules](/azure/azure-resource-manager/management/resource-name-rules#microsoftweb)
- [Storage account types](/azure/storage/common/storage-account-overview#types-of-storage-accounts) and [storage account names](/azure/storage/common/storage-account-overview#storage-account-name)
- [Minimum TLS configuration for storage accounts](/azure/storage/common/transport-layer-security-configure-minimum-version)

#### App Service and API references

Consult these references for hosting plans and resource schemas:

- [App Service hosting plans and pricing tiers](/azure/app-service/overview-hosting-plans#pricing-tiers)
- [PremiumV3 prerequisites](/azure/app-service/app-service-configure-premium-v3-tier) and [PremiumV3 redeployment guidance](/azure/app-service/app-service-configure-premium-v3-tier#scale-up-from-an-unsupported-resource-group-and-region-combination)
- [Windows App Service ARM template quickstart](/azure/app-service/quickstart-arm-template)
- [Template reference for each Azure resource type](/azure/templates/)
- [Storage account schema, API 2023-05-01](/azure/templates/microsoft.storage/2023-05-01/storageaccounts) and [storage account create contract](/rest/api/storagerp/storage-accounts/create?view=rest-storagerp-2023-05-01)
- [App Service plan schema, API 2023-12-01](/azure/templates/microsoft.web/2023-12-01/serverfarms) and [App Service app schema, API 2023-12-01](/azure/templates/microsoft.web/2023-12-01/sites)
- [App Service plan schema, API 2024-04-01](/azure/templates/microsoft.web/2024-04-01/serverfarms) and [App Service app schema, API 2024-04-01](/azure/templates/microsoft.web/2024-04-01/sites)

#### Further learning

Continue learning or revisit the exercises and production guidance:

- [Fundamentals of Bicep learning path](xref:learn.bicep-deploy-manage)
- [Published exercise: Define resources in a Bicep file](/training/modules/build-first-bicep-file/4-exercise-define-resources-bicep-file)
- [Selecting SKUs for resources](/training/modules/build-first-bicep-file/5-add-flexibility-parameters-variables#selecting-skus-for-resources)

